import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { DeviceLogEntry } from '@kindred-log/shared/crypto';
import { and, eq } from 'drizzle-orm';
import type { KeysResponse } from '@kindred-log/shared/sync';
import { DB, schema, type Db, type Tx } from '../db/db';
import { RECOVERY, type AuthContext } from '../auth/auth.service';
import { appendVerified, lockFamily } from '../families/families.service';
import { LiveBus } from '../live/live';

@Injectable()
export class KeysService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LiveBus) private readonly live: LiveBus,
  ) {}

  /** Every epoch sealed for the caller (a device, or the recovery key). */
  async mine(auth: AuthContext): Promise<KeysResponse> {
    const [family] = await this.db.select().from(schema.families).where(eq(schema.families.id, auth.familyId));
    const keys = await this.db
      .select({ epoch: schema.familyKeys.epoch, recipient: schema.familyKeys.recipient, sealed: schema.familyKeys.sealed })
      .from(schema.familyKeys)
      .where(and(eq(schema.familyKeys.familyId, auth.familyId), eq(schema.familyKeys.recipient, auth.deviceId)));
    return { currentEpoch: family.currentEpoch, keys, missing: auth.deviceId === RECOVERY ? [] : await this.missing(family) };
  }

  /** Members (and the recovery key) that lack some epochs, so a phone that has them can grant them. */
  private async missing(family: { id: string; currentEpoch: number; recoverySignKey: string | null }) {
    const members = await this.db
      .select({ id: schema.devices.id })
      .from(schema.devices)
      .where(and(eq(schema.devices.familyId, family.id), eq(schema.devices.active, true)));
    const recipients = [...members.map((m) => m.id), ...(family.recoverySignKey ? [RECOVERY] : [])];
    const held = await this.db
      .select({ recipient: schema.familyKeys.recipient, epoch: schema.familyKeys.epoch })
      .from(schema.familyKeys)
      .where(eq(schema.familyKeys.familyId, family.id));
    const has = new Set(held.map((k) => `${k.recipient}/${k.epoch}`));
    const epochs = Array.from({ length: family.currentEpoch }, (_, i) => i + 1);
    return recipients
      .map((recipient) => ({ recipient, epochs: epochs.filter((e) => !has.has(`${recipient}/${e}`)) }))
      .filter((m) => m.epochs.length);
  }

  /** Hands existing epochs to a member that was just added, or to a newly set recovery key. */
  async grant(auth: AuthContext, recipient: string, keys: { epoch: number; sealed: string }[]) {
    await this.db.transaction(async (tx) => {
      const family = await lockFamily(tx, auth.familyId);
      await this.assertRecipient(tx, auth.familyId, recipient, family.recoverySignKey !== null);
      if (keys.some((k) => k.epoch > family.currentEpoch)) throw new BadRequestException('Unknown epoch');
      for (const k of keys) {
        await tx
          .insert(schema.familyKeys)
          .values({ familyId: auth.familyId, epoch: k.epoch, recipient, sealed: k.sealed })
          // Never replaces a key someone already has (a retried grant is fine; overwriting would only break things).
          .onConflictDoNothing();
      }
    });
    return { ok: true };
  }

  /**
   * Starts the next epoch after a removal: the signed `epoch` log entry (committing to the key) and the key
   * sealed to exactly the current members (and the recovery key, if set), so nobody is silently left out or added.
   */
  async rotate(auth: AuthContext, entry: DeviceLogEntry, sealed: Record<string, string>) {
    if (entry.type !== 'epoch' || entry.signer !== auth.deviceId) throw new ForbiddenException('Epochs must be started by the caller');
    const epoch = entry.epoch!;
    await this.db.transaction(async (tx) => {
      const family = await lockFamily(tx, auth.familyId);
      if (epoch !== family.currentEpoch + 1) throw new BadRequestException(`Next epoch is ${family.currentEpoch + 1}`);
      // The entry closes the old epochs at this seq: the phone must have pulled everything, so no genuine record
      // lies beyond it. Required: without it the log would leave the old epochs open.
      if (entry.closedSeq !== family.seq) {
        throw new ConflictException(`Pull first: the family is at seq ${family.seq}`);
      }
      await appendVerified(tx, auth.familyId, entry);
      const members = await tx
        .select({ id: schema.devices.id })
        .from(schema.devices)
        .where(and(eq(schema.devices.familyId, auth.familyId), eq(schema.devices.active, true)));
      const expected = new Set(members.map((m) => m.id));
      if (family.recoverySignKey) expected.add(RECOVERY);
      const given = Object.keys(sealed);
      if (given.length !== expected.size || !given.every((r) => expected.has(r))) {
        throw new BadRequestException('The new key must be sealed to every current member and nobody else');
      }
      await tx.insert(schema.familyKeys).values(given.map((recipient) => ({ familyId: auth.familyId, epoch, recipient, sealed: sealed[recipient] })));
      await tx.update(schema.families).set({ currentEpoch: epoch }).where(eq(schema.families.id, auth.familyId));
    });
    this.live.publish(auth.familyId, { type: 'log', index: entry.index });
    this.live.publish(auth.familyId, { type: 'keys', epoch });
    return { currentEpoch: epoch };
  }

  private async assertRecipient(tx: Tx, familyId: string, recipient: string, hasRecovery: boolean) {
    if (recipient === RECOVERY) {
      if (!hasRecovery) throw new BadRequestException('No recovery key is set');
      return;
    }
    const [device] = await tx
      .select()
      .from(schema.devices)
      .where(and(eq(schema.devices.id, recipient), eq(schema.devices.familyId, familyId), eq(schema.devices.active, true)));
    if (!device) throw new BadRequestException('Recipient is not a member');
  }
}
