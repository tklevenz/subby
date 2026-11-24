import { HttpException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sum } from 'drizzle-orm';
import { GRACE_MS, HOSTED_PHOTO_BYTES, INACTIVE_DELETE_DAYS, TRIAL_MS, type EntitlementResponse, type SyncAccess } from '@subby/shared/sync';
import { CONFIG, type Config } from '../config';
import { DB, schema, type Db, type Tx } from '../db/db';

/**
 * A phone joining after the trial gets no grace if a phone without its own unlock left the family from this long
 * before it joined until its grace would end: leaving and joining again makes a new identity each time, which
 * would otherwise sync for free, 48 hours at a time.
 */
export const REJOIN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** 402: this phone's trial and grace are over and it has no unlock; it can still pull. The app shows the unlock screen. */
export const notUnlocked = () => new HttpException({ statusCode: 402, message: 'This phone needs Subby Sync unlocked to write' }, 402);

type DeviceAccess = { id: string; access: SyncAccess; graceEndsAt: number | null };

/**
 * Who may sync (PROJECT.md §3). Self-hosted servers: everyone, always. Hosted: a family's phones sync during its
 * 14-day trial (from when a second phone first joined); after it, each phone needs its own unlock or one of the
 * family's gifted slots. Slots go to the phones without an unlock in the order they joined, so a removed phone's
 * slot passes on by itself. A phone
 * without either still syncs for 48 h after the trial (or after joining, if later; not after joining around when a
 * phone without its own unlock left, `REJOIN_WINDOW_MS`), then only pulls.
 */
@Injectable()
export class Entitlements {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: Db,
  ) {}

  get hosted() {
    return this.config.mode === 'hosted';
  }

  /**
   * Every active phone's access, in join order, plus the family's trial and slots. The trial runs from when the
   * family's second phone first joined (removed ones count, so it starts once), or from its creation while a phone
   * is alone: sharing is what the trial is for, and a parent setting up sync days before the partner joins
   * shouldn't lose those days.
   */
  async family(familyId: string, now = Date.now()) {
    const [family] = await this.db.select({ createdAt: schema.families.createdAt }).from(schema.families).where(eq(schema.families.id, familyId));
    // Removed phones too (few per family): when the second one joined, and who left without an unlock.
    const all = await this.db
      .select({ id: schema.devices.id, addedAt: schema.devices.addedAt, active: schema.devices.active, leftLockedAt: schema.devices.leftLockedAt })
      .from(schema.devices)
      .where(eq(schema.devices.familyId, familyId))
      .orderBy(asc(schema.devices.addedAt), asc(schema.devices.id));
    const members = all.filter((d) => d.active);
    if (!this.hosted || !family) {
      return {
        trialEndsAt: null,
        trialStartsOnJoin: false,
        slots: 0,
        freeSlots: 0,
        devices: members.map((m): DeviceAccess => ({ id: m.id, access: 'free', graceEndsAt: null })),
      };
    }
    const trialStartsOnJoin = all.length < 2;
    const trialEndsAt = Math.max(family.createdAt.getTime(), all[1]?.addedAt.getTime() ?? 0) + TRIAL_MS;
    const unlocked = new Set(
      members.length
        ? (
            await this.db
              .select({ deviceId: schema.purchases.deviceId })
              .from(schema.purchases)
              .where(
                and(
                  eq(schema.purchases.kind, 'unlock'),
                  eq(schema.purchases.revoked, false),
                  inArray(
                    schema.purchases.deviceId,
                    members.map((m) => m.id),
                  ),
                ),
              )
          ).map((p) => p.deviceId)
        : [],
    );
    const slots = await this.db.$count(
      schema.purchases,
      and(eq(schema.purchases.familyId, familyId), eq(schema.purchases.kind, 'slot'), eq(schema.purchases.revoked, false)),
    );
    // When phones left after the trial without their own unlock.
    const leftLocked = all.flatMap((d) => (!d.active && d.leftLockedAt && d.leftLockedAt.getTime() >= trialEndsAt ? [d.leftLockedAt.getTime()] : []));
    const joinGrace = (joined: number) =>
      joined <= trialEndsAt || !leftLocked.some((at) => at >= joined - REJOIN_WINDOW_MS && at <= joined + GRACE_MS);
    let left = slots;
    const devices = members.map((m): DeviceAccess => {
      if (unlocked.has(m.id)) return { id: m.id, access: 'unlock', graceEndsAt: null };
      if (left > 0) {
        left--;
        return { id: m.id, access: 'slot', graceEndsAt: null };
      }
      const joined = m.addedAt.getTime();
      // No grace: it ended when the phone joined, after the trial, so it's read-only right away.
      const graceEndsAt = joinGrace(joined) ? Math.max(trialEndsAt, joined) + GRACE_MS : joined;
      return { id: m.id, access: now < trialEndsAt ? 'trial' : now < graceEndsAt ? 'grace' : 'readOnly', graceEndsAt };
    });
    return { trialEndsAt, trialStartsOnJoin, slots, freeSlots: left, devices };
  }

  /** GET /v1/entitlement, for one phone. */
  async forDevice(familyId: string, deviceId: string, now = Date.now()): Promise<EntitlementResponse> {
    const f = await this.family(familyId, now);
    const me = f.devices.find((d) => d.id === deviceId);
    return {
      access: me?.access ?? (this.hosted ? 'readOnly' : 'free'),
      trialEndsAt: f.trialEndsAt,
      trialStartsOnJoin: f.trialStartsOnJoin,
      graceEndsAt: me?.graceEndsAt ?? null,
      slots: f.slots,
      freeSlots: f.freeSlots,
      devices: f.devices.map(({ id, access }) => ({ id, access })),
      photoBytes: await this.photoBytes(familyId),
      photoLimit: this.hosted ? HOSTED_PHOTO_BYTES : null,
      inactiveDays: this.hosted ? INACTIVE_DELETE_DAYS : null,
    };
  }

  /** Whether this phone may write (push records, upload photos). Pulling is always allowed. */
  async canSync(familyId: string, deviceId: string, now = Date.now()): Promise<boolean> {
    if (!this.hosted) return true;
    const { devices } = await this.family(familyId, now);
    const access = devices.find((d) => d.id === deviceId)?.access;
    return access !== undefined && access !== 'readOnly';
  }

  /** Whether the family has room for another encrypted file of `bytes` (2 GB of photos per family when hosted). */
  async canStore(familyId: string, bytes: number, db: Db | Tx = this.db): Promise<boolean> {
    if (!this.hosted) return true;
    return (await this.photoBytes(familyId, db)) + bytes <= HOSTED_PHOTO_BYTES;
  }

  private async photoBytes(familyId: string, db: Db | Tx = this.db) {
    const [row] = await db.select({ total: sum(schema.blobs.size) }).from(schema.blobs).where(eq(schema.blobs.familyId, familyId));
    return Number(row?.total ?? 0);
  }
}
