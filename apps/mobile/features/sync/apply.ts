import { and, eq, inArray } from 'drizzle-orm';
import { notePhoto, type Child, type LogEntry } from '@subby/shared';
import { UnsealedRecordError, clientApplies, openRecord, type MovedBody, type SyncRecord } from '@subby/shared/sync';
import { db, schema } from '../../db/client';
import { deletedLog, deletedLogs } from '../../db/tombstone';
import { deletePhoto } from '../photos';
import type { PulledLog } from '../reminders/family';
import { bodyToChild, bodyToLog, childTombstone, validBody, type ChildBody, type LogBody } from './records';
import { saveSync, syncSettings } from './state';

/** A phone's display name, as its encrypted `device` record (id = that phone's device id). */
export type DeviceBody = { name: string };

/** Entries other phones wrote, applied during this run (for `notifyFamily`). */
let pulledLogs: PulledLog[] = [];
/** The first run after a move pulls everything again, all of it already here: no family notifications for it. */
let quiet = false;
export const quietNextRun = () => {
  quiet = true;
};


/** Decrypts, checks and applies one page (see `openAll` and `applyOpened`). */
export async function applyPage(records: SyncRecord[], keys: ReadonlyMap<number, Uint8Array>, ownDeviceId: string): Promise<boolean> {
  return applyOpened(openAll(records, keys), ownDeviceId);
}

export type Opened = { record: SyncRecord; body: ChildBody | LogBody | DeviceBody | MovedBody | null };

/**
 * Decrypts and checks records, before anything is written. A record of an epoch we have no key for throws, failing
 * the run (the next one fetches the key). One that doesn't open with a key we have (damaged or tampered with), one
 * that opens but is malformed (a buggy or hostile phone), or a tombstone nobody sealed (an older app's, or a
 * server's), is skipped, so a single bad record can't stop sync for good. Bodies come back as checked.
 */
export function openAll(records: SyncRecord[], keys: ReadonlyMap<number, Uint8Array>): Opened[] {
  return records
    .flatMap((r) => {
      try {
        return [{ record: r, body: openRecord<Opened['body']>(keys, r) }];
      } catch (e) {
        if (e instanceof UnsealedRecordError) console.warn(`[sync] skipped unsealed ${r.kind} record ${r.id}`);
        else if (keys.has(r.epoch)) console.warn(`[sync] skipped ${r.kind} record ${r.id}: it doesn't open`, e);
        else throw e;
        return [];
      }
    })
    .flatMap(({ record, body }) => {
      if (record.deleted) return [{ record, body }];
      const valid = validBody<NonNullable<Opened['body']>>(record.kind, body);
      if (valid) return [{ record, body: valid }];
      console.warn(`[sync] skipped malformed ${record.kind} record ${record.id}`);
      return [];
    });
}

/** Applies opened records in a transaction. Newer local edits that aren't pushed yet win (same rule as the server). */
export async function applyOpened(opened: Opened[], ownDeviceId: string): Promise<boolean> {
  await applyDeviceNames(opened.filter((o) => o.record.kind === 'device'));
  await noteMove(opened.filter((o) => o.record.kind === 'moved'), ownDeviceId);
  const photos: (string | null | undefined)[] = [];
  let changed = false;

  db.transaction((tx) => {
    const childIds = opened.filter((o) => o.record.kind === 'child').map((o) => o.record.id);
    const logIds = opened.filter((o) => o.record.kind === 'log').map((o) => o.record.id);
    const localChildren = new Map(
      (childIds.length ? tx.select().from(schema.childrenTable).where(inArray(schema.childrenTable.id, childIds)).all() : []).map((c) => [c.id, c]),
    );
    const localLogs = new Map(
      (logIds.length ? tx.select().from(schema.logsTable).where(inArray(schema.logsTable.id, logIds)).all() : []).map((l) => [l.id, l]),
    );

    for (const { record: r, body } of opened) {
      if (r.kind === 'device' || r.kind === 'moved') continue; // applied above
      const local: Child | LogEntry | undefined = r.kind === 'child' ? localChildren.get(r.id) : localLogs.get(r.id);
      // Our own upload coming back: already applied.
      if (local && r.deviceId === ownDeviceId && local.updatedAt === r.updatedAt) continue;
      const localVersion = local ? { updatedAt: local.updatedAt, pending: local.syncStatus === 'pending' } : null;
      if (!clientApplies(localVersion, r, ownDeviceId)) continue;
      changed = true;

      if (r.kind === 'child') {
        const row = r.deleted ? childTombstone(r.id, r.updatedAt, 'synced') : bodyToChild(r.id, body as ChildBody, r, local as Child | undefined);
        tx.insert(schema.childrenTable).values(row).onConflictDoUpdate({ target: schema.childrenTable.id, set: row }).run();
        // This phone's copy of a photo the new version no longer uses (replaced, removed or deleted).
        const oldPhoto = (local as Child | undefined)?.photoUri;
        if (oldPhoto && oldPhoto !== row.photoUri) photos.push(oldPhoto);
        if (r.deleted) {
          for (const note of tx.select().from(schema.logsTable).where(and(eq(schema.logsTable.childId, r.id), eq(schema.logsTable.logType, 'note'))).all()) {
            photos.push(notePhoto(note.payload));
          }
          tx.update(schema.logsTable)
            .set(deletedLogs({ importRef: null, syncStatus: 'synced' }))
            .where(eq(schema.logsTable.childId, r.id))
            .run();
        }
      } else if (r.deleted) {
        const old = local as LogEntry | undefined;
        if (!old) continue; // never had it; nothing to delete
        photos.push(notePhoto(old.payload));
        tx.update(schema.logsTable)
          .set(deletedLog(old.logType, { importRef: null, updatedAt: r.updatedAt, syncStatus: 'synced' }))
          .where(eq(schema.logsTable.id, r.id))
          .run();
        if (r.deviceId !== ownDeviceId) pulledLogs.push({ before: old, after: { ...old, isDeleted: true }, deviceId: r.deviceId });
      } else {
        const row = bodyToLog(r.id, body as LogBody, r, local as LogEntry | undefined);
        tx.insert(schema.logsTable).values(row).onConflictDoUpdate({ target: schema.logsTable.id, set: row }).run();
        const old = local as LogEntry | undefined;
        if (r.deviceId !== ownDeviceId) pulledLogs.push({ before: old ?? null, after: row, deviceId: r.deviceId });
        const oldPhoto = old && notePhoto(old.payload);
        if (oldPhoto && oldPhoto !== notePhoto(row.payload)) photos.push(oldPhoto);
      }
    }
  });

  for (const uri of photos) deletePhoto(uri ?? undefined);
  return changed;
}

/** Names arrive as encrypted `device` records (id = that phone's device id). */
async function applyDeviceNames(records: { record: SyncRecord; body: unknown }[]) {
  if (!records.length) return;
  const names = { ...syncSettings()?.names };
  for (const { record, body } of records) {
    if (record.deleted) delete names[record.id];
    else names[record.id] = (body as DeviceBody).name;
  }
  await saveSync({ names });
}

/** Another phone moved the family to another server: remember where, and follow on the next round (`followMove`). */
async function noteMove(records: Opened[], ownDeviceId: string) {
  const current = syncSettings();
  for (const { record, body } of records) {
    const moved = body as MovedBody | null;
    if (record.deleted || !moved || !current || record.deviceId === ownDeviceId || moved.from !== record.deviceId || moved.familyId === current.familyId) continue;
    await saveSync({ move: moved });
  }
}

/** The entries other phones wrote since the last call, for `notifyFamily`; none for a run made quiet by `quietNextRun`. */
export function takePulledLogs(): PulledLog[] {
  const pulled = quiet ? [] : pulledLogs;
  pulledLogs = [];
  quiet = false;
  return pulled;
}
