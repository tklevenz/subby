import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
  StreamableFile,
  UseGuards,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, eq, inArray, isNull, lt, notInArray, or } from 'drizzle-orm';
import { MAX_BLOB_BYTES, UNLINKED_BLOB_TTL_MS, type SyncRecord } from '@subby/shared/sync';
import { DB, schema, type Db } from '../db/db';
import { familyTransaction } from '../db/lock';
import { Auth, DeviceGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.service';
import { Entitlements, notUnlocked } from '../sync/entitlements';
import { BLOB_STORE, type BlobStore } from './store';
import { logError } from '../common/errors';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const SWEEP_EVERY_MS = 60 * 60 * 1000;

/**
 * Encrypted files (photos). The server can't see which record uses a blob from the ciphertext, so each record
 * version lists its blob ids (`SyncRecord.blobs`); blobs a record stops listing, and every blob of a deleted
 * record, are removed. Uploads no record ever lists are swept after a day.
 */
@Injectable()
export class BlobsService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(BLOB_STORE) private readonly store: BlobStore,
    @Inject(Entitlements) private readonly entitlements: Entitlements,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep().catch((e: unknown) => logError('Blob sweep failed', e)), SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async put(auth: AuthContext, id: string, data: Uint8Array) {
    if (!(await this.entitlements.canSync(auth.familyId, auth.deviceId))) throw notUnlocked();
    // Row first, claiming the id: a second upload under the same id (another family's too) gets a conflict before it
    // can touch the stored file. A failed write takes the row back; until the file is there, a read finds nothing.
    // The allowance check and the claim happen under the family's lock, so uploads at once can't all pass it.
    const claimed = await familyTransaction(this.db, auth.familyId, async (tx) => {
      if (!(await this.entitlements.canStore(auth.familyId, data.length, tx))) throw new ForbiddenException('No storage left for this family');
      return tx
        .insert(schema.blobs)
        .values({ id, familyId: auth.familyId, size: data.length, createdAt: Date.now() })
        .onConflictDoNothing()
        .returning({ id: schema.blobs.id });
    });
    if (!claimed.length) throw new ConflictException('A file with this id already exists');
    try {
      await this.store.put(id, data);
    } catch (e) {
      await this.db.delete(schema.blobs).where(eq(schema.blobs.id, id));
      throw e;
    }
  }

  async get(auth: AuthContext, id: string) {
    const [row] = await this.db
      .select({ id: schema.blobs.id })
      .from(schema.blobs)
      .where(and(eq(schema.blobs.id, id), eq(schema.blobs.familyId, auth.familyId)));
    const blob = row ? await this.store.get(id) : null;
    if (!blob) throw new NotFoundException('No such file');
    return blob;
  }

  /**
   * Inside a push transaction: links each accepted record's listed blobs to it and drops the ones it no
   * longer lists (one version per record). Returns the ids to delete from storage once the transaction has committed.
   */
  async link(tx: Tx, familyId: string, accepted: SyncRecord[]): Promise<string[]> {
    // A record without `blobs` comes from an older app: its blobs are left alone.
    const listing = accepted.filter((r) => r.deleted || r.blobs !== undefined);
    if (!listing.length) return [];
    const withPhotos = listing.filter((r) => !r.deleted && r.blobs!.length);
    const without = listing.filter((r) => r.deleted || !r.blobs!.length).map((r) => r.id);
    // Few records have photos; each claims its own.
    for (const r of withPhotos) {
      await tx
        .update(schema.blobs)
        .set({ recordId: r.id })
        // Only unlinked uploads, or this record's own: a record can't take over (and later delete) another's photo.
        .where(and(eq(schema.blobs.familyId, familyId), inArray(schema.blobs.id, r.blobs!), or(isNull(schema.blobs.recordId), eq(schema.blobs.recordId, r.id))));
    }
    // Everything the records no longer list, in one statement.
    const gone = await tx
      .delete(schema.blobs)
      .where(
        and(
          eq(schema.blobs.familyId, familyId),
          or(
            ...(without.length ? [inArray(schema.blobs.recordId, without)] : []),
            ...withPhotos.map((r) => and(eq(schema.blobs.recordId, r.id), notInArray(schema.blobs.id, r.blobs!))),
          ),
        ),
      )
      .returning({ id: schema.blobs.id });
    return gone.map((b) => b.id);
  }

  /** Deletes stored files whose rows are gone. Failures only leave orphan files behind. */
  async deleteFiles(ids: string[]) {
    for (const id of ids) await this.store.delete(id).catch((e: unknown) => logError("Couldn't delete a photo file", e));
  }

  /** Removes uploads that no record listed within the grace period (abandoned or rejected pushes). */
  async sweep(now = Date.now()) {
    const gone = await this.db
      .delete(schema.blobs)
      .where(and(isNull(schema.blobs.recordId), lt(schema.blobs.createdAt, now - UNLINKED_BLOB_TTL_MS)))
      .returning({ id: schema.blobs.id });
    await this.deleteFiles(gone.map((b) => b.id));
    return gone.length;
  }
}

@Controller('v1/blobs')
@UseGuards(DeviceGuard)
export class BlobsController {
  constructor(@Inject(BlobsService) private readonly blobs: BlobsService) {}

  /** Body: the encrypted file, `content-type: application/octet-stream`. */
  @Put(':id')
  @HttpCode(204)
  async put(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) rawId: string, @Body() body: unknown) {
    // One spelling per id: Postgres hands back ids in lowercase, and every later delete uses those. A file stored
    // under an uppercase name would never be deleted.
    const id = rawId.toLowerCase();
    if (!(body instanceof Uint8Array) || body.length === 0) throw new BadRequestException('Send the file as application/octet-stream');
    if (body.length > MAX_BLOB_BYTES) throw new BadRequestException('File too large');
    await this.blobs.put(auth, id, body);
  }

  @Get(':id')
  async get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const { body, size } = await this.blobs.get(auth, id.toLowerCase());
    // Streamed from disk or the bucket. A failure halfway is logged without its message (it names the file).
    return new StreamableFile(body, { type: 'application/octet-stream', length: size }).setErrorLogger((e) => logError('Sending a photo failed', e));
  }
}
