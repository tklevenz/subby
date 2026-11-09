import { HttpException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sum } from 'drizzle-orm';
import { GRACE_MS, HOSTED_PHOTO_BYTES, TRIAL_MS, type EntitlementResponse, type SyncAccess } from '@subby/shared/sync';
import { CONFIG, type Config } from '../config';
import { DB, schema, type Db, type Tx } from '../db/db';

/** 402: this phone's trial and grace are over and it has no unlock; it can still pull. The app shows the unlock screen. */
export const notUnlocked = () => new HttpException({ statusCode: 402, message: 'This phone needs Subby Sync unlocked to write' }, 402);

type DeviceAccess = { id: string; access: SyncAccess; graceEndsAt: number | null };

/**
 * Who may sync (PROJECT.md §3). Self-hosted servers: everyone, always. Hosted: a family's phones sync during its
 * 14-day trial; after it, each phone needs its own unlock or one of the family's gifted slots. Slots go to the
 * phones without an unlock in the order they joined, so a removed phone's slot passes on by itself. A phone
 * without either still syncs for 48 h after the trial (or after joining, if later), then only pulls.
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

  /** Every active phone's access, in join order, plus the family's trial and slots. */
  async family(familyId: string, now = Date.now()) {
    const [family] = await this.db.select({ createdAt: schema.families.createdAt }).from(schema.families).where(eq(schema.families.id, familyId));
    const members = await this.db
      .select({ id: schema.devices.id, addedAt: schema.devices.addedAt })
      .from(schema.devices)
      .where(and(eq(schema.devices.familyId, familyId), eq(schema.devices.active, true)))
      .orderBy(asc(schema.devices.addedAt), asc(schema.devices.id));
    if (!this.hosted || !family) {
      return { trialEndsAt: null, slots: 0, freeSlots: 0, devices: members.map((m): DeviceAccess => ({ id: m.id, access: 'free', graceEndsAt: null })) };
    }
    const trialEndsAt = family.createdAt.getTime() + TRIAL_MS;
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
    let left = slots;
    const devices = members.map((m): DeviceAccess => {
      if (unlocked.has(m.id)) return { id: m.id, access: 'unlock', graceEndsAt: null };
      if (left > 0) {
        left--;
        return { id: m.id, access: 'slot', graceEndsAt: null };
      }
      const graceEndsAt = Math.max(trialEndsAt, m.addedAt.getTime()) + GRACE_MS;
      return { id: m.id, access: now < trialEndsAt ? 'trial' : now < graceEndsAt ? 'grace' : 'readOnly', graceEndsAt };
    });
    return { trialEndsAt, slots, freeSlots: left, devices };
  }

  /** GET /v1/entitlement, for one phone. */
  async forDevice(familyId: string, deviceId: string, now = Date.now()): Promise<EntitlementResponse> {
    const f = await this.family(familyId, now);
    const me = f.devices.find((d) => d.id === deviceId);
    return {
      access: me?.access ?? (this.hosted ? 'readOnly' : 'free'),
      trialEndsAt: f.trialEndsAt,
      graceEndsAt: me?.graceEndsAt ?? null,
      slots: f.slots,
      freeSlots: f.freeSlots,
      devices: f.devices.map(({ id, access }) => ({ id, access })),
      photoBytes: await this.photoBytes(familyId),
      photoLimit: this.hosted ? HOSTED_PHOTO_BYTES : null,
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
