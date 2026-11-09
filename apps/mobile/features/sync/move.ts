import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  RECOVERY_SIGNER,
  appendEntry,
  assertLogContinues,
  encryptFile,
  fromBase64,
  movedFamilyLog,
  newSymmetricKey,
  openFamilyKey,
  seal,
  toBase64,
  verifyDeviceLog,
  verifyMovedLog,
  type DeviceLogEntry,
} from '@subby/shared/crypto';
import { sealRecord, type MovedBody } from '@subby/shared/sync';
import { db, schema } from '../../db/client';
import { readPhotoBytes } from '../photos';
import { useSettingsStore, type SyncSettings } from '../../store/useSettingsStore';
import { checkServer, createFamily, normalizeServerUrl, SyncHttpError, SyncSession } from './api';
import { deviceIdentity, saveFamilyKeys } from './keystore';
import { setUpBackgroundSync } from './background';
import {
  forgetSession,
  openLive,
  pushDeviceName,
  quietNextRun,
  refreshKeys,
  refreshMembers,
  requestSync,
  sessionFor,
  syncNow,
  syncSettings,
  useSyncStore,
} from './engine';

/**
 * Moving the family to another server (official ↔ self-hosted), without pairing again (LAUNCH.md A13).
 *
 * The moving phone builds the new family from the old one's verified log: the same phones with the same keys,
 * the same recovery key (`movedFamilyLog`), and a new family key sealed to each. It uploads the photos under
 * their ids and keys, so every record stays as it is, then tells the old family where it went with an encrypted
 * `moved` record, switches over, and pushes everything. The other phones follow on their next sync
 * (`followMove`). Each phone leaves the old family as it goes; the last one leaving deletes it there.
 */
export async function moveToServer(serverInput: string, onStep: (label: string) => void = () => {}) {
  const old = syncSettings();
  if (!old) throw new Error('Sync is not set up on this phone');
  const server = normalizeServerUrl(serverInput);
  if (server === normalizeServerUrl(old.server)) throw new Error('Your family already syncs through this server');
  await checkServer(server);

  // Everything of the old family is here first: this phone's copy is what moves.
  onStep('Syncing with the current server');
  await syncNow();
  if (useSyncStore.getState().phase === 'error') throw new Error(useSyncStore.getState().error ?? "Couldn't sync with the current server");
  const settings = syncSettings()!;
  const oldApi = sessionFor(settings);
  const { entries: oldEntries, state: oldState } = await refreshMembers(oldApi, settings);
  const { keys: oldKeys, epoch: oldEpoch } = await refreshKeys(oldApi, oldState);

  onStep('Setting up your family there');
  const me = { id: settings.deviceId, keys: deviceIdentity() };
  const familyId = uuidv7();
  const familyKey = newSymmetricKey();
  const log = movedFamilyLog(oldState, me, familyKey, Date.now());
  try {
    await createFamily(server, { familyId, entry: log[0]!, sealedKey: toBase64(seal(me.keys.box.publicKey, familyKey)) });
  } catch (e) {
    if (e instanceof SyncHttpError && e.status === 409) throw new Error('This phone is already in a family on that server. Turn sync off there first, or finish the earlier move.');
    throw e;
  }
  const api = new SyncSession(server, me.id, me.keys);
  try {
    for (const entry of log.slice(1)) await api.request('POST', '/v1/families/me/log', { entry });
    const newState = verifyDeviceLog(log);
    for (const [id, m] of newState.members) {
      if (id !== me.id) await api.request('POST', '/v1/keys/grant', { recipient: id, keys: [{ epoch: 1, sealed: toBase64(seal(m.boxKey, familyKey)) }] });
    }
    if (newState.recovery) {
      await api.request('POST', '/v1/keys/grant', { recipient: RECOVERY_SIGNER, keys: [{ epoch: 1, sealed: toBase64(seal(newState.recovery.boxKey, familyKey)) }] });
    }
    await uploadPhotosAsTheyAre(api, (done) => onStep(`Copying photos · ${done}`));

    // The old family learns where it went. Sealed with its key, so its server can't point the phones elsewhere.
    const moved: MovedBody = { server, familyId, from: me.id, seq: settings.lastSeq, entries: log.length };
    await oldApi.push([sealRecord(oldKeys.get(oldEpoch)!, oldEpoch, { id: familyId, kind: 'moved', updatedAt: Date.now(), deviceId: me.id, deleted: false }, moved)]);
  } catch (e) {
    // Nothing points at the new family yet: take it down again, so a retry starts clean.
    await api.request('DELETE', '/v1/families/me').catch(() => {});
    throw e;
  }

  onStep('Copying your entries');
  await switchTo(settings, { server, familyId, entries: log, key: familyKey, members: [...verifyDeviceLog(log).members.keys()] });
  // Names stay as they were (each phone's own record, written here for them).
  for (const [id, name] of Object.entries(settings.names ?? {})) {
    if (verifyDeviceLog(log).members.has(id)) await pushDeviceName(name, id).catch(() => {});
  }
  await leave(oldApi, oldEntries, me);
  await syncNow();
}

/**
 * This phone follows a move another phone made: checks the new family's log against the old one it trusts,
 * takes the new family key (checked against that log), sends again what it wrote to the old family after the
 * mover had pulled, then switches and leaves the old family. Throws (to retry on the next run) when the new
 * server isn't reachable or the key isn't granted yet.
 */
export async function followMove(settings: SyncSettings, move: MovedBody) {
  const me = { id: settings.deviceId, keys: deviceIdentity() };
  const oldApi = sessionFor(settings);
  const api = new SyncSession(move.server, me.id, me.keys);
  try {
    const { entries: oldEntries } = await oldApi.log();
    // The old server can't hide a removal behind an older list than this phone already saw.
    assertLogContinues(oldEntries, settings.logSeen);
    const login = await api.login();
    if (login.familyId !== move.familyId) throw new Error('This phone is in another family on the new server');
    const { entries } = await api.log();
    const state = verifyMovedLog(oldEntries, entries, move.from, me.id, move.entries);
    const res = await api.keys();
    const sealed = res.keys.find((k) => k.epoch === state.epoch);
    if (!sealed) throw new Error("The new server hasn't got this phone's key yet");
    const keys = new Map(res.keys.map((k) => [k.epoch, openFamilyKey(me.keys, state, k.epoch, fromBase64(k.sealed))]));

    // What this phone wrote to the old family after the mover's last pull isn't in the new one yet.
    const own: string[] = [];
    for (let since = move.seq; ; ) {
      const page = await oldApi.pull(since);
      own.push(...page.records.filter((r) => r.deviceId === me.id && (r.kind === 'child' || r.kind === 'log')).map((r) => r.id));
      if (!page.more || page.seq <= since) break;
      since = page.seq;
    }
    for (let i = 0; i < own.length; i += 500) {
      const ids = own.slice(i, i + 500);
      await db.update(schema.childrenTable).set({ syncStatus: 'pending' }).where(inArray(schema.childrenTable.id, ids));
      await db.update(schema.logsTable).set({ syncStatus: 'pending' }).where(inArray(schema.logsTable.id, ids));
    }

    await switchTo(settings, { server: move.server, familyId: move.familyId, entries, key: null, keys, members: [...state.members.keys()] });
    await leave(oldApi, oldEntries, me);
    useSyncStore.setState({ movedTo: move.server });
  } catch (e) {
    // Not "removed": that's about the old family, which this phone is still in.
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(`Your family moved to ${move.server.replace(/^https?:\/\//, '')}, but this phone couldn't follow yet: ${why}`);
  }
}

/** Points this phone at the new family: its keys, server and log; every row of it then syncs there. */
async function switchTo(
  settings: SyncSettings,
  next: { server: string; familyId: string; entries: DeviceLogEntry[]; key: Uint8Array | null; keys?: Map<number, Uint8Array>; members: string[] },
) {
  saveFamilyKeys(next.keys ?? new Map([[1, next.key!]]));
  // The mover sends everything it has; a follower only what the mover can't have (marked pending before this).
  if (next.key) {
    await db.update(schema.childrenTable).set({ syncStatus: 'pending' });
    await db.update(schema.logsTable).set({ syncStatus: 'pending' });
  }
  const { move: _, pushToken: __, push: ___, ...kept } = settings;
  forgetSession();
  quietNextRun();
  await useSettingsStore.getState().set('sync', {
    ...kept,
    server: next.server,
    familyId: next.familyId,
    lastSeq: 0,
    knownDevices: next.members,
    // Photo references stay valid: the blobs are on the new server under the same ids and keys.
    photosFamily: next.familyId,
    logSeen: { length: next.entries.length, head: verifyDeviceLog(next.entries).head },
  });
  openLive();
  setUpBackgroundSync().catch((e: unknown) => console.warn('[sync] background setup after the move failed', e));
  requestSync(0);
}

/** Leaves the old family by itself (best effort); the last phone leaving deletes it on that server. */
async function leave(oldApi: SyncSession, entries: DeviceLogEntry[], me: { id: string; keys: ReturnType<typeof deviceIdentity> }) {
  try {
    const { entries: latest } = await oldApi.log().catch(() => ({ entries }));
    const state = verifyDeviceLog(latest);
    if (!state.members.has(me.id)) return;
    await oldApi.request('POST', '/v1/families/me/log', { entry: appendEntry(state, latest.length, me, { type: 'remove', deviceId: me.id }, Date.now()) });
  } catch (e) {
    console.warn('[sync] couldn’t leave the old family', e);
  }
}

/** Uploads every photo this phone has to the new server under its existing blob id and key, so records stay as they are. */
async function uploadPhotosAsTheyAre(api: SyncSession, onProgress: (done: number) => void) {
  const c = schema.childrenTable;
  const l = schema.logsTable;
  const children = await db
    .select({ uri: c.photoUri, blob: c.photoBlob })
    .from(c)
    .where(and(eq(c.isDeleted, false), isNotNull(c.photoUri), isNotNull(c.photoBlob)));
  const notes = await db
    .select({ payload: l.payload })
    .from(l)
    .where(
      and(
        eq(l.logType, 'note'),
        eq(l.isDeleted, false),
        sql`json_extract(${l.payload}, '$.photoBlob') is not null`,
        sql`json_extract(${l.payload}, '$.photoUri') is not null`,
      ),
    );
  const photos = [
    ...children.map((r) => ({ uri: r.uri!, blob: r.blob! })),
    ...notes.flatMap(({ payload: p }) => (p.type === 'note' && p.photoUri && p.photoBlob ? [{ uri: p.photoUri, blob: p.photoBlob }] : [])),
  ];
  let done = 0;
  for (const { uri, blob } of photos) {
    const data = await readPhotoBytes(uri);
    // A missing file: the entry moves without it, like any photo that never synced.
    if (!data) continue;
    await api.putBlob(blob.id, encryptFile(fromBase64(blob.key), data));
    onProgress(++done);
  }
}
