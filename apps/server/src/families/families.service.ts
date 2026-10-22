import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte } from 'drizzle-orm';
import { verifyDeviceLog, type DeviceLogEntry } from '@kindred-log/shared/crypto';
import { DB, schema, type Db, type Tx } from '../db/db';
import { RECOVERY, type AuthContext } from '../auth/auth.service';
import { LiveBus } from '../live/live';

/** Replays the log; a broken one is the client's fault (400), never stored. */
function verified(entries: DeviceLogEntry[]) {
  try {
    return verifyDeviceLog(entries);
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }
}

@Injectable()
export class FamiliesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LiveBus) private readonly live: LiveBus,
  ) {}

  /** The first device creates the family: its self-signed `create` entry and its sealed epoch-1 key. */
  async create(familyId: string, entry: DeviceLogEntry, sealedKey: string) {
    if (entry.type !== 'create') throw new BadRequestException('The first entry must be "create"');
    verified([entry]);
    await this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(schema.families).where(eq(schema.families.id, familyId));
      const [device] = await tx.select().from(schema.devices).where(eq(schema.devices.id, entry.deviceId));
      if (existing || device) throw new ConflictException('Family or device already exists');
      await tx.insert(schema.families).values({ id: familyId });
      await tx.insert(schema.deviceLog).values({ familyId, index: 0, entry });
      await tx.insert(schema.devices).values({ id: entry.deviceId, familyId, signKey: entry.signKey! });
      await tx.insert(schema.familyKeys).values({ familyId, epoch: 1, recipient: entry.deviceId, sealed: sealedKey });
    });
    return { familyId };
  }

  async log(familyId: string, since = 0) {
    const rows = await this.db
      .select({ entry: schema.deviceLog.entry })
      .from(schema.deviceLog)
      .where(and(eq(schema.deviceLog.familyId, familyId), gte(schema.deviceLog.index, since)))
      .orderBy(asc(schema.deviceLog.index));
    return { entries: rows.map((r) => r.entry) };
  }

  /** Appends one entry after verifying the whole chain with it, then applies its effect. */
  async append(auth: AuthContext, entry: DeviceLogEntry) {
    if (entry.signer !== auth.deviceId) throw new ForbiddenException('Entries must be signed by the caller');
    const result = await this.db.transaction(async (tx) => {
      await lockFamily(tx, auth.familyId);
      const rows = await tx
        .select({ entry: schema.deviceLog.entry })
        .from(schema.deviceLog)
        .where(eq(schema.deviceLog.familyId, auth.familyId))
        .orderBy(asc(schema.deviceLog.index));
      verified([...rows.map((r) => r.entry), entry]);
      await tx.insert(schema.deviceLog).values({ familyId: auth.familyId, index: entry.index, entry });
      await this.apply(tx, auth.familyId, entry);
      return { index: entry.index };
    });
    if (entry.type === 'remove') this.live.closeDevice(auth.familyId, entry.deviceId);
    this.live.publish(auth.familyId, { type: 'log', index: entry.index });
    return result;
  }

  private async apply(tx: Tx, familyId: string, entry: DeviceLogEntry) {
    switch (entry.type) {
      case 'add': {
        const [taken] = await tx.select().from(schema.devices).where(eq(schema.devices.id, entry.deviceId));
        if (taken) throw new ConflictException('Device id already in use');
        await tx.insert(schema.devices).values({ id: entry.deviceId, familyId, signKey: entry.signKey! });
        // A pairing invite for this device is now done.
        const open = await tx.select().from(schema.invites).where(eq(schema.invites.familyId, familyId));
        for (const invite of open) {
          if (invite.claimant?.deviceId === entry.deviceId) {
            await tx.update(schema.invites).set({ status: 'approved' }).where(eq(schema.invites.id, invite.id));
            this.live.publish(familyId, { type: 'invite', inviteId: invite.id, status: 'approved' });
          }
        }
        break;
      }
      case 'remove':
        await tx.update(schema.devices).set({ active: false }).where(eq(schema.devices.id, entry.deviceId));
        await tx.delete(schema.sessions).where(eq(schema.sessions.deviceId, entry.deviceId));
        await tx
          .delete(schema.familyKeys)
          .where(and(eq(schema.familyKeys.familyId, familyId), eq(schema.familyKeys.recipient, entry.deviceId)));
        break;
      case 'setRecovery':
        // Keys sealed to the old recovery key are useless now; the new one gets them granted again.
        await tx.update(schema.families).set({ recoverySignKey: entry.signKey }).where(eq(schema.families.id, familyId));
        await tx
          .delete(schema.familyKeys)
          .where(and(eq(schema.familyKeys.familyId, familyId), eq(schema.familyKeys.recipient, RECOVERY)));
        await tx.delete(schema.sessions).where(and(eq(schema.sessions.familyId, familyId), eq(schema.sessions.deviceId, RECOVERY)));
        break;
    }
  }
}

/** Serializes writes per family (log appends, key rotation, sync seq). */
export async function lockFamily(tx: Tx, familyId: string) {
  const [family] = await tx.select().from(schema.families).where(eq(schema.families.id, familyId)).for('update');
  if (!family) throw new BadRequestException('Unknown family');
  return family;
}
