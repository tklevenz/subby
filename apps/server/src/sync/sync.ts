import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Inject, Injectable, Post, Query, UseGuards } from '@nestjs/common';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { PushSchema, serverAccepts, type PullResponse, type PushResponse, type SyncRecord } from '@kindred-log/shared/sync';
import { DB, schema, type Db } from '../db/db';
import { parse, queryInt } from '../common/validate';
import { Auth, DeviceGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.service';
import { lockFamily } from '../families/families.service';
import { LiveBus } from '../live/live';
import { Entitlements, notUnlocked } from './entitlements';
import { BlobsService } from '../blobs/blobs';
import { PushService } from '../push/push';

const PULL_LIMIT = 1000;
/** A `moved` record's sealed body (server URL, two ids, a seq) is far below this. */
const MOVED_MAX_CHARS = 2048;

@Injectable()
export class SyncService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LiveBus) private readonly live: LiveBus,
    @Inject(Entitlements) private readonly entitlements: Entitlements,
    @Inject(BlobsService) private readonly blobs: BlobsService,
    @Inject(PushService) private readonly pushes: PushService,
  ) {}

  /** Stores each record if it is newer than the server's copy; every accepted record gets the next seq. */
  async push(auth: AuthContext, records: SyncRecord[]): Promise<PushResponse> {
    // A phone without an unlock may still tell its family it moved elsewhere (leaving is always free): one small
    // `moved` record, nothing else.
    const onlyMoved = records.length === 1 && records[0]!.kind === 'moved' && (records[0]!.data?.length ?? 0) <= MOVED_MAX_CHARS;
    if (!onlyMoved && !(await this.entitlements.canSync(auth.familyId, auth.deviceId))) throw notUnlocked();
    for (const r of records) {
      if (r.deviceId !== auth.deviceId) throw new ForbiddenException('Records must be written as the calling device');
      // Tombstones carry a sealed empty body (older apps sent none); everything else needs its data.
      if (!r.deleted && r.data === null) throw new BadRequestException(`Record ${r.id} has no data`);
    }

    const result = await this.db.transaction(async (tx) => {
      const family = await lockFamily(tx, auth.familyId);
      // New data (deletions too) must use the current key, so a rotation actually locks removed devices out of new writes.
      const old = records.find((r) => r.epoch !== family.currentEpoch);
      if (old) throw new BadRequestException(`Record ${old.id} uses epoch ${old.epoch}; current is ${family.currentEpoch}`);

      const ids = [...new Set(records.map((r) => r.id))];
      const stored = new Map(
        (
          await tx
            .select({ id: schema.records.id, updatedAt: schema.records.updatedAt, deviceId: schema.records.deviceId })
            .from(schema.records)
            .where(and(eq(schema.records.familyId, auth.familyId), inArray(schema.records.id, ids)))
        ).map((s) => [s.id, s]),
      );

      let seq = family.seq;
      const accepted: SyncRecord[] = [];
      const stale: string[] = [];
      for (const r of records) {
        if (!serverAccepts(stored.get(r.id) ?? null, r)) {
          stale.push(r.id);
          continue;
        }
        seq += 1;
        const { blobs: _, ...record } = r;
        const row = { ...record, familyId: auth.familyId, seq };
        await tx
          .insert(schema.records)
          .values(row)
          .onConflictDoUpdate({ target: [schema.records.familyId, schema.records.id], set: row });
        stored.set(r.id, r);
        accepted.push(r);
      }
      if (seq !== family.seq) await tx.update(schema.families).set({ seq }).where(eq(schema.families.id, auth.familyId));
      const dropped = await this.blobs.link(tx, auth.familyId, accepted);
      // The versions that beat this push, so the phone can apply them without pulling everything again.
      const newer = stale.length
        ? (await tx.select().from(schema.records).where(and(eq(schema.records.familyId, auth.familyId), inArray(schema.records.id, stale)))).map(
            ({ familyId: _, ...r }) => r,
          )
        : [];
      return { seq, accepted: accepted.map((r) => r.id), stale, newer, dropped };
    });

    await this.blobs.deleteFiles(result.dropped);
    if (result.accepted.length) {
      this.live.publish(auth.familyId, { type: 'seq', seq: result.seq });
      this.pushes.changed(auth.familyId, auth.deviceId);
    }
    return { seq: result.seq, accepted: result.accepted, stale: result.stale, newer: result.newer };
  }

  async pull(auth: AuthContext, since: number, limit: number): Promise<PullResponse> {
    const rows = await this.db
      .select()
      .from(schema.records)
      .where(and(eq(schema.records.familyId, auth.familyId), gt(schema.records.seq, since)))
      .orderBy(asc(schema.records.seq))
      .limit(limit + 1);
    const page = rows.slice(0, limit).map(({ familyId: _, ...r }) => r);
    return { records: page, seq: page.at(-1)?.seq ?? since, more: rows.length > limit };
  }
}

@Controller('v1/sync')
@UseGuards(DeviceGuard)
export class SyncController {
  constructor(@Inject(SyncService) private readonly sync: SyncService) {}

  @Post('push')
  @HttpCode(200)
  push(@Auth() auth: AuthContext, @Body() body: unknown) {
    return this.sync.push(auth, parse(PushSchema, body).records);
  }

  @Get('pull')
  pull(@Auth() auth: AuthContext, @Query('since') since?: string, @Query('limit') limit?: string) {
    return this.sync.pull(auth, queryInt(since, 0, Number.MAX_SAFE_INTEGER), Math.min(Math.max(1, queryInt(limit, PULL_LIMIT)), PULL_LIMIT));
  }
}
