import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, ne } from 'drizzle-orm';
import { verifyDeviceLog, type DeviceLogEntry } from '@subby/shared/crypto';
import { MAX_LOG_ENTRIES } from '@subby/shared/sync';
import { DB, schema, type Db, type Tx } from '../db/db';
import { RECOVERY, type AuthContext } from '../auth/auth.service';
import { LiveBus } from '../live/live';
import { BlobsService } from '../blobs/blobs';
import { familyTransaction } from '../db/lock';
import { PushService } from '../push/push';

/** Replays the log; a broken one is the client's fault (400), never stored. */
function verified(entries: DeviceLogEntry[], trusted = 0) {
  try {
    return verifyDeviceLog(entries, { trusted });
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }
}

@Injectable()
export class FamiliesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LiveBus) private readonly live: LiveBus,
    @Inject(BlobsService) private readonly blobs: BlobsService,
    @Inject(PushService) private readonly push: PushService,
  ) {}

  /** The first device creates the family: its self-signed `create` entry and its sealed epoch-1 key. */
  async create(familyId: string, entry: DeviceLogEntry, sealedKey: string) {
    if (entry.type !== 'create') throw new BadRequestException('The first entry must be "create"');
    verified([entry]);
    await this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(schema.families).where(eq(schema.families.id, familyId));
      const [device] = await tx.select().from(schema.devices).where(eq(schema.devices.id, entry.deviceId));
      if (existing || device) throw new ConflictException('Family or device already exists');
      // Two creates at once both get past the check above: the second one's insert finds the row.
      const [created] = await tx.insert(schema.families).values({ id: familyId }).onConflictDoNothing().returning({ id: schema.families.id });
      if (!created) throw new ConflictException('Family or device already exists');
      await tx.insert(schema.deviceLog).values({ familyId, index: 0, entry });
      const [joined] = await tx.insert(schema.devices).values({ id: entry.deviceId, familyId, signKey: entry.signKey! }).onConflictDoNothing().returning({ id: schema.devices.id });
      if (!joined) throw new ConflictException('Family or device already exists');
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
    // An epoch comes with its sealed keys (POST /v1/keys/rotate), so nobody is left without the new key.
    if (entry.type === 'epoch' || entry.type === 'create') throw new BadRequestException(`"${entry.type}" entries can't be appended here`);
    const { result, deleted, wake } = await familyTransaction(this.db, auth.familyId, async (tx) => {
      await appendVerified(tx, auth.familyId, [entry]);
      // Removed by another phone (or the recovery key), not leaving: its push token, read before it's dropped.
      const wake =
        entry.type === 'remove' && entry.signer !== entry.deviceId
          ? (
              await tx
                .select({ deviceId: schema.pushTokens.deviceId, token: schema.pushTokens.token, platform: schema.pushTokens.platform })
                .from(schema.pushTokens)
                .where(and(eq(schema.pushTokens.familyId, auth.familyId), eq(schema.pushTokens.deviceId, entry.deviceId)))
            )[0]
          : undefined;
      await this.apply(tx, auth.familyId, entry);
      // The last phone left: nobody can sync any more, so nothing of the family stays (recovery words included).
      const remaining = entry.type === 'remove' ? await tx.$count(schema.devices, and(eq(schema.devices.familyId, auth.familyId), eq(schema.devices.active, true))) : 1;
      return { result: { index: entry.index }, deleted: remaining === 0 ? await deleteRows(tx, auth.familyId) : null, wake };
    });
    if (deleted) {
      await this.afterDelete(auth.familyId, deleted);
      return result;
    }
    if (wake) this.push.wakeRemoved(wake);
    if (entry.type === 'remove') this.live.closeDevice(auth.familyId, entry.deviceId);
    this.live.publish(auth.familyId, { type: 'log', index: entry.index });
    return result;
  }

  /**
   * Takes back entries a phone verified that this server lost (it was restored from a backup), signed as they were.
   * Each must continue the log and pass the whole chain's checks, as on append. Epochs come without their sealed
   * keys: the phones that hold them grant them on their next sync, as for any member missing a key.
   */
  async restore(auth: AuthContext, entries: DeviceLogEntry[]) {
    if (entries.some((e) => e.type === 'create')) throw new BadRequestException('Restored entries continue the family log');
    const { result, deleted } = await familyTransaction(this.db, auth.familyId, async (tx) => {
      // Checked as one batch: each entry's signature once, the stored log replayed once.
      await appendVerified(tx, auth.familyId, entries);
      for (const entry of entries) {
        await this.apply(tx, auth.familyId, entry);
        if (entry.type === 'epoch') await tx.update(schema.families).set({ currentEpoch: entry.epoch! }).where(eq(schema.families.id, auth.familyId));
      }
      const remaining = await tx.$count(schema.devices, and(eq(schema.devices.familyId, auth.familyId), eq(schema.devices.active, true)));
      return { result: { index: entries.at(-1)!.index }, deleted: remaining === 0 ? await deleteRows(tx, auth.familyId) : null };
    });
    if (deleted) {
      await this.afterDelete(auth.familyId, deleted);
      return result;
    }
    for (const e of entries) if (e.type === 'remove') this.live.closeDevice(auth.familyId, e.deviceId);
    this.live.publish(auth.familyId, { type: 'log', index: result.index });
    return result;
  }

  /**
   * Deletes everything the server holds for the family: records, keys, the device log, devices, sessions,
   * invites, push tokens and photo files. The phones keep their own data; the others find out on their next sync
   * (they can't log in any more, like a removed phone).
   */
  async delete(familyId: string) {
    const blobIds = await familyTransaction(this.db, familyId, (tx) => deleteRows(tx, familyId));
    await this.afterDelete(familyId, blobIds);
  }

  private async afterDelete(familyId: string, blobIds: string[]) {
    this.live.closeFamily(familyId);
    await this.blobs.deleteFiles(blobIds);
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
            await tx.update(schema.invites).set({ status: 'approved' }).where(and(eq(schema.invites.familyId, familyId), eq(schema.invites.id, invite.id)));
            this.live.publish(familyId, { type: 'invite', inviteId: invite.id, status: 'approved' });
          }
        }
        break;
      }
      case 'remove': {
        // Device ids are unique across families, but every write names the family anyway.
        await tx
          .update(schema.devices)
          .set({ active: false })
          .where(and(eq(schema.devices.familyId, familyId), eq(schema.devices.id, entry.deviceId)));
        await tx.delete(schema.sessions).where(and(eq(schema.sessions.familyId, familyId), eq(schema.sessions.deviceId, entry.deviceId)));
        await tx.delete(schema.pushTokens).where(and(eq(schema.pushTokens.familyId, familyId), eq(schema.pushTokens.deviceId, entry.deviceId)));
        await tx
          .delete(schema.familyKeys)
          .where(and(eq(schema.familyKeys.familyId, familyId), eq(schema.familyKeys.recipient, entry.deviceId)));
        break;
      }
      case 'setRecovery': {
        // The recovery key finds its family by this key, so it can belong to one family only.
        if (entry.signKey) {
          const [other] = await tx
            .select({ id: schema.families.id })
            .from(schema.families)
            .where(and(eq(schema.families.recoverySignKey, entry.signKey), ne(schema.families.id, familyId)));
          if (other) throw new ConflictException('This recovery key is already in use');
        }
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
}

/** Inside a locked transaction: deletes the family row (every table cascades from it). Returns its photo ids. */
async function deleteRows(tx: Tx, familyId: string) {
  const blobs = await tx.select({ id: schema.blobs.id }).from(schema.blobs).where(eq(schema.blobs.familyId, familyId));
  await tx.delete(schema.families).where(eq(schema.families.id, familyId));
  return blobs.map((b) => b.id);
}

/**
 * Inside a locked transaction: checks `entries` as the continuation of the stored log, then stores them. The stored
 * entries were verified when they came in, so only the new ones' signatures are checked (`trusted`); the whole log
 * is still replayed for the chain and the rules. Refuses a log longer than MAX_LOG_ENTRIES.
 */
export async function appendVerified(tx: Tx, familyId: string, entries: DeviceLogEntry[]) {
  const rows = await tx
    .select({ entry: schema.deviceLog.entry })
    .from(schema.deviceLog)
    .where(eq(schema.deviceLog.familyId, familyId))
    .orderBy(asc(schema.deviceLog.index));
  if (rows.length + entries.length > MAX_LOG_ENTRIES) {
    throw new ConflictException(`The family's device log is full (${MAX_LOG_ENTRIES} entries)`);
  }
  const state = verified([...rows.map((r) => r.entry), ...entries], rows.length);
  await tx.insert(schema.deviceLog).values(entries.map((entry) => ({ familyId, index: entry.index, entry })));
  return state;
}
