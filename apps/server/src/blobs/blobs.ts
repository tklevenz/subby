import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, eq, inArray, isNull, lt, notInArray, or } from 'drizzle-orm';
import { MAX_BLOB_BYTES, UNLINKED_BLOB_TTL_MS, type SyncRecord } from '@kindred-log/shared/sync';
import { DB, schema, type Db } from '../db/db';
import { Auth, DeviceGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.service';
import { Entitlements } from '../sync/entitlements';
import { BLOB_STORE, type BlobStore } from './store';

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
    this.timer = setInterval(() => void this.sweep().catch((e: unknown) => console.warn('Blob sweep failed', e)), SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async put(auth: AuthContext, id: string, data: Uint8Array) {
    if (!(await this.entitlements.canStore(auth.familyId, data.length))) throw new ForbiddenException('No storage left for this family');
    // Row first, claiming the id: a second upload under the same id (another family's too) gets a conflict before it
    // can touch the stored file. A failed write takes the row back; until the file is there, a read finds nothing.
    const claimed = await this.db
      .insert(schema.blobs)
      .values({ id, familyId: auth.familyId, size: data.length, createdAt: Date.now() })
      .onConflictDoNothing()
      .returning({ id: schema.blobs.id });
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
    const data = row ? await this.store.get(id) : null;
    if (!data) throw new NotFoundException('No such file');
    return data;
  }

  /**
   * Inside a push transaction: links each accepted record's listed blobs to it and drops the ones it no
   * longer lists. Returns the ids to delete from storage once the transaction has committed.
   */
  async link(tx: Tx, familyId: string, accepted: SyncRecord[]): Promise<string[]> {
    const dropped: string[] = [];
    for (const r of accepted) {
      const keep = r.deleted ? [] : r.blobs;
      if (keep === undefined) continue; // an older app: leave this record's blobs alone
      if (keep.length) {
        await tx
          .update(schema.blobs)
          .set({ recordId: r.id })
          // Only unlinked uploads, or this record's own: a record can't take over (and later delete) another's photo.
          .where(and(eq(schema.blobs.familyId, familyId), inArray(schema.blobs.id, keep), or(isNull(schema.blobs.recordId), eq(schema.blobs.recordId, r.id))));
      }
      const gone = await tx
        .delete(schema.blobs)
        .where(
          and(
            eq(schema.blobs.familyId, familyId),
            eq(schema.blobs.recordId, r.id),
            ...(keep.length ? [notInArray(schema.blobs.id, keep)] : []),
          ),
        )
        .returning({ id: schema.blobs.id });
      dropped.push(...gone.map((b) => b.id));
    }
    return dropped;
  }

  /** Deletes stored files whose rows are gone. Failures only leave orphan files behind. */
  async deleteFiles(ids: string[]) {
    for (const id of ids) await this.store.delete(id).catch((e: unknown) => console.warn(`Couldn't delete blob ${id}`, e));
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
  async put(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    if (!(body instanceof Uint8Array) || body.length === 0) throw new BadRequestException('Send the file as application/octet-stream');
    if (body.length > MAX_BLOB_BYTES) throw new BadRequestException('File too large');
    await this.blobs.put(auth, id, body);
  }

  @Get(':id')
  @Header('content-type', 'application/octet-stream')
  async get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const data = await this.blobs.get(auth, id);
    // A view, not a copy (photos are up to 20 MB).
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
}
