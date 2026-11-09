import { create } from 'zustand';
import * as Device from 'expo-device';
import { and, count, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { uuidv7 } from 'uuidv7';
import type { Child, LogEntry } from '@subby/shared';
import {
  RECOVERY_SIGNER,
  appendEntry,
  assertLogContinues,
  fromBase64,
  newSymmetricKey,
  openFamilyKey,
  seal,
  toBase64,
  verifyDeviceLog,
  withinEpoch,
  type DeviceLogEntry,
  type DeviceLogState,
} from '@subby/shared/crypto';
import { MAX_RECORD_DATA, UnsealedRecordError, clientApplies, openRecord, pageContinues, pushChunks, settlePush, sealRecord, type MovedBody, type SyncRecord } from '@subby/shared/sync';
import { db, schema } from '../../db/client';
import { deletePhoto } from '../photos';
import { useChildStore } from '../../store/useChildStore';
import { useLogStore } from '../../store/useLogStore';
import { useSettingsStore, type SyncSettings } from '../../store/useSettingsStore';
import { checkServer, createFamily, normalizeServerUrl, SyncHttpError, SyncSession } from './api';
import { notifyFamily, type PulledLog } from '../reminders/family';
import { clearSyncSecrets, deviceIdentity, loadFamilyKeys, saveFamilyKeys } from './keystore';
import { blobIdsOf, bodyToChild, bodyToLog, childToBody, childTombstone, logToBody, validBody, scrubbedPayload, type ChildBody, type LogBody } from './records';
import { downloadPhotos, forgetPhotoUploads, queueUnsyncedPhotos, uploadPhotos } from './photos';
import { canWrite, forgetAccess, refreshEntitlement } from './access';
import { followMove } from './move';

const PUSH_BATCH = 500;

type SyncStatus = {
  phase: 'off' | 'idle' | 'syncing' | 'error';
  error: string | null;
  /** Local changes not yet uploaded. */
  pending: number;
  /** During a long first upload or download. */
  progress: { label: string; done: number } | null;
  /** The family's phones, from the verified device log. */
  members: { id: string; isMe: boolean }[];
  /** Phones that joined since this phone last looked (shown once as a heads-up). */
  newDevices: string[];
  /** Another phone removed this one from the family: it can only turn sync off. */
  removed: boolean;
  /** Whether the family has a recovery key (from the verified device log). */
  hasRecovery: boolean;
  /** Local changes too large for the server, left unsynced (a very long note). */
  tooLarge: number;
  /** The family just moved to this server (this phone followed): shown once. */
  movedTo: string | null;
};

export const useSyncStore = create<SyncStatus>(() => ({ phase: 'off', error: null, pending: 0, progress: null, members: [], newDevices: [], removed: false, hasRecovery: false, tooLarge: 0, movedTo: null }));

let session: SyncSession | null = null;
export function sessionFor(s: SyncSettings) {
  if (!session || session.server !== s.server || session.deviceId !== s.deviceId) {
    session = new SyncSession(s.server, s.deviceId, deviceIdentity());
  }
  return session;
}

export const syncSettings = () => useSettingsStore.getState().sync;
export const saveSync = (patch: Partial<SyncSettings>) => {
  const current = syncSettings();
  return current ? useSettingsStore.getState().set('sync', { ...current, ...patch }) : Promise.resolve();
};

export async function pendingCount(): Promise<number> {
  const [c] = await db.select({ n: count() }).from(schema.childrenTable).where(eq(schema.childrenTable.syncStatus, 'pending'));
  const [l] = await db.select({ n: count() }).from(schema.logsTable).where(eq(schema.logsTable.syncStatus, 'pending'));
  return (c?.n ?? 0) + (l?.n ?? 0);
}

// --- setup / leave ----------------------------------------------------------------------------------------

/** Creates a new family on the server with this phone as its first device, then uploads everything. */
export async function setUpSync(serverInput: string, deviceName: string) {
  const server = normalizeServerUrl(serverInput);
  await checkServer(server);

  const identity = deviceIdentity();
  const deviceId = uuidv7();
  const familyId = uuidv7();
  const keys = { sign: identity.sign.publicKey, box: identity.box.publicKey };
  const familyKey = newSymmetricKey();
  // The create entry commits to the first family key, so every phone can check the key it's given.
  const entry = appendEntry(null, 0, { id: deviceId, keys: identity }, { type: 'create', deviceId, keys, familyKey: { epoch: 1, key: familyKey } }, Date.now());
  await createFamily(server, { familyId, entry, sealedKey: toBase64(seal(identity.box.publicKey, familyKey)) });

  saveFamilyKeys(new Map([[1, familyKey]]));
  // Everything on this phone goes up, including deletions made before sync existed, and photos to this family.
  await db.update(schema.childrenTable).set({ syncStatus: 'pending' });
  await db.update(schema.logsTable).set({ syncStatus: 'pending' });
  await forgetPhotoUploads();
  await useSettingsStore
    .getState()
    .set('sync', {
      server,
      familyId,
      deviceId,
      lastSeq: 0,
      lastSyncedAt: null,
      since: Date.now(),
      knownDevices: [deviceId],
      photosFamily: familyId,
      logSeen: { length: 1, head: verifyDeviceLog([entry]).head },
    });
  await pushDeviceName(deviceName);
  requestSync(0);
}

/** Stops syncing on this phone. Local data stays; this phone's keys are forgotten. */
export async function turnOffSync() {
  const settings = syncSettings();
  // Leave the family properly when the server is reachable; offline, the other phones can remove this one.
  // The last phone leaving deletes the family on the server.
  if (settings) await leaveFamily(settings).catch(() => {});
  await forgetSync();
}

/**
 * Deletes the family and everything the server holds for it (records, photos, keys, recovery key), then turns
 * sync off here. Every phone keeps its own data; the others see it like being removed. Throws if the server
 * can't be reached, so nothing is forgotten here while the data is still there.
 */
export async function deleteFamilyOnServer() {
  const settings = syncSettings();
  if (!settings) return;
  await sessionFor(settings).request('DELETE', '/v1/families/me');
  await forgetSync();
}

/** After switching servers (a move): the next request logs in to the new one, and live reconnects there. */
export function forgetSession() {
  closeLive();
  forgetAccess();
  session = null;
}

async function forgetSync() {
  forgetSession();
  await useSettingsStore.getState().set('sync', null);
  await clearSyncSecrets();
  useSyncStore.setState({ phase: 'off', error: null, progress: null, members: [], newDevices: [], removed: false, hasRecovery: false });
}

async function leaveFamily(settings: SyncSettings) {
  const api = sessionFor(settings);
  const { entries, state } = await refreshMembers(api, settings);
  const me = { id: settings.deviceId, keys: deviceIdentity() };
  const entry = appendEntry(state, entries.length, me, { type: 'remove', deviceId: settings.deviceId }, Date.now());
  await api.request('POST', '/v1/families/me/log', { entry });
}

// --- one sync run -----------------------------------------------------------------------------------------

let running: Promise<void> | null = null;
let again = false;

/** Runs a sync now, or once more right after the current one finishes. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await runOnce();
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Debounced trigger for local writes, app foreground and live notifications. */
export function requestSync(delayMs = 1500) {
  if (!syncSettings()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    syncNow().catch(() => {});
  }, delayMs);
}

async function runOnce() {
  const settings = syncSettings();
  if (!settings) {
    useSyncStore.setState({ phase: 'off' });
    return;
  }
  useSyncStore.setState({ phase: 'syncing', error: null });
  try {
    // Another phone moved the family: follow it before anything else touches the old one.
    if (settings.move) {
      useSyncStore.setState({ progress: { label: 'Moving to the new server', done: 0 } });
      await followMove(settings, settings.move);
      again = true;
      return;
    }
    const api = sessionFor(settings);
    let { entries, state } = await refreshMembers(api, settings);
    let keys = await refreshKeys(api, state);
    // Finish what a phone left half done (a grant or a rotation), then work with the result.
    if (await heal(api, settings, entries, state, keys)) {
      ({ entries, state } = await refreshMembers(api, settings));
      keys = await refreshKeys(api, state);
    }
    // A phone moved to another family before photo references were tracked: re-upload its own photos once.
    // Only then: run every time, it would re-queue a photo that stays on this phone (too large, or no room on the
    // server) with a new version on every run, pushing it forever and overwriting other phones' edits.
    if (settings.photosFamily !== settings.familyId) {
      await forgetPhotoUploads({ onlyLocal: true });
      await queueUnsyncedPhotos();
      await saveSync({ photosFamily: settings.familyId });
    }
    // A phone without an unlock (hosted, after the trial) still pulls; its own changes wait, pending, until it's unlocked.
    await refreshEntitlement(api);
    const pushed = canWrite() ? await pushUnlessLocked(api, settings, keys) : { applied: false, tooLarge: 0 };
    const applied = (await pullAll(api, settings, keys, syncSettings()?.lastSeq ?? settings.lastSeq)) || pushed.applied;
    const photos = await downloadPhotos(api, (done) => useSyncStore.setState({ progress: { label: 'Downloading photos', done } }));
    // Phones set up before names existed (or whose name record was lost) name themselves once.
    if (!syncSettings()?.names?.[settings.deviceId] && canWrite()) await pushDeviceName(defaultDeviceName());
    await saveSync({ lastSyncedAt: Date.now() });
    if (applied || photos) await reloadStores();
    // A pulled `moved` record: the next round follows it.
    if (syncSettings()?.move) again = true;
    const pulled = quiet ? [] : pulledLogs;
    pulledLogs = [];
    quiet = false;
    await notifyFamily(pulled).catch((e) => console.warn('Family notifications failed', e));
    useSyncStore.setState({ phase: 'idle', error: null, removed: false, progress: null, pending: await pendingCount(), tooLarge: pushed.tooLarge });
  } catch (e) {
    const removed = isRemoved(e);
    const message = removed ? 'This phone is no longer in the family' : e instanceof Error ? e.message : String(e);
    useSyncStore.setState({ phase: 'error', error: message, removed, progress: null, pending: await pendingCount() });
    throw e;
  }
}

/** Pushes; a 402 (the trial or grace just ended) only means this phone's changes wait for an unlock. */
async function pushUnlessLocked(api: SyncSession, settings: SyncSettings, keys: Keys) {
  try {
    return await pushAll(api, settings, keys);
  } catch (e) {
    if (!(e instanceof SyncHttpError && e.status === 402)) throw e;
    await refreshEntitlement(api);
    return { applied: false, tooLarge: 0 };
  }
}

/** A removed device can't log in any more (its sessions and membership are gone). */
export const isRemoved = (e: unknown) =>
  e instanceof SyncHttpError && (e.status === 401 || (e.status === 404 && /unknown device/i.test(e.message)));

/**
 * Verifies the signed device log (a server can't add phones on its own, nor serve an older log than this phone
 * saw) and publishes the members. Phones that weren't there last time are flagged once, so a parent notices a
 * phone they didn't add.
 */
export async function refreshMembers(api: SyncSession, settings: SyncSettings) {
  const { entries } = await api.log();
  assertLogContinues(entries, syncSettings()?.logSeen ?? settings.logSeen);
  const state = verifyDeviceLog(entries);
  if (syncSettings()?.logSeen?.length !== entries.length) await saveSync({ logSeen: { length: entries.length, head: state.head } });
  if (!state.members.has(settings.deviceId)) throw new SyncHttpError(401, 'Removed');
  const ids = [...state.members.keys()];
  const known = new Set(settings.knownDevices ?? [settings.deviceId]);
  const added = ids.filter((id) => !known.has(id));
  if (added.length || ids.length !== known.size) await saveSync({ knownDevices: ids });
  useSyncStore.setState((s) => ({
    members: ids.map((id) => ({ id, isMe: id === settings.deviceId })),
    hasRecovery: state.recovery !== null,
    newDevices: added.length ? [...s.newDevices, ...added] : s.newDevices,
  }));
  return { entries, state };
}

/**
 * Opens any family keys sealed to this device that it doesn't have yet (new epochs after a removal), each checked
 * against its commitment in the verified device log. The current epoch is the log's, never the server's word.
 */
export async function refreshKeys(api: SyncSession, state?: DeviceLogState) {
  const log = state ?? (await refreshMembers(api, syncSettings()!)).state;
  const keys = loadFamilyKeys();
  const res = await api.keys();
  let changed = false;
  for (const k of res.keys) {
    if (keys.has(k.epoch)) continue;
    keys.set(k.epoch, openFamilyKey(deviceIdentity(), log, k.epoch, fromBase64(k.sealed)));
    changed = true;
  }
  if (changed) saveFamilyKeys(keys);
  if (!keys.has(log.epoch)) throw new Error('Missing the current family key');
  return { keys, epoch: log.epoch, missing: res.missing ?? [], closedAt: log.closedAt };
}

type Keys = Awaited<ReturnType<typeof refreshKeys>>;

/**
 * Finishes what another phone (or this one) left half done: grants epochs a member lacks, sealed only to keys from
 * the verified log, and starts the epoch the log says is owed (after a removal or a replaced recovery key).
 * Returns whether it changed anything. A rotation another phone made first is fine.
 */
async function heal(api: SyncSession, settings: SyncSettings, entries: DeviceLogEntry[], state: DeviceLogState, { keys, missing }: Keys) {
  let changed = false;
  for (const { recipient, epochs } of missing) {
    const member = recipient === RECOVERY_SIGNER ? state.recovery : state.members.get(recipient);
    const held = epochs.filter((e) => keys.has(e));
    if (!member || !held.length) continue;
    await api.request('POST', '/v1/keys/grant', {
      recipient,
      keys: held.map((epoch) => ({ epoch, sealed: toBase64(seal(member.boxKey, keys.get(epoch)!)) })),
    });
    changed = true;
  }
  if (state.rotationDue) {
    try {
      await rotateKeys(api, settings, entries, state, keys);
    } catch (e) {
      // Another phone rotated at the same moment: its epoch counts.
      if (!(e instanceof SyncHttpError && (e.status === 400 || e.status === 409))) throw e;
    }
    changed = true;
  }
  return changed;
}

/**
 * Starts the next epoch: its signed log entry commits to a new key, sealed to every member and the recovery key,
 * stored by the server in one step. Whoever had the old key (a removed phone, old recovery words) can't read on.
 * The entry also closes the old epochs at the seq this phone has pulled to (`closedSeq`), so nothing written with
 * an old key later counts. The server takes it only at the family's latest seq: pull first, again if another
 * phone pushed in between.
 */
export async function rotateKeys(api: SyncSession, settings: SyncSettings, entries: DeviceLogEntry[], state: DeviceLogState, keys: Map<number, Uint8Array>) {
  const me = { id: settings.deviceId, keys: deviceIdentity() };
  const epoch = state.epoch + 1;
  const key = newSymmetricKey();
  const sealed: Record<string, string> = {};
  for (const [id, m] of state.members) sealed[id] = toBase64(seal(m.boxKey, key));
  if (state.recovery) sealed[RECOVERY_SIGNER] = toBase64(seal(state.recovery.boxKey, key));
  const current: Keys = { keys, epoch: state.epoch, missing: [], closedAt: state.closedAt };
  for (let attempt = 1; ; attempt++) {
    if (await pullAll(api, settings, current, syncSettings()?.lastSeq ?? 0)) await reloadStores();
    const closedSeq = syncSettings()?.lastSeq ?? 0;
    const entry = appendEntry(state, entries.length, me, { type: 'epoch', deviceId: me.id, familyKey: { epoch, key }, closedSeq }, Date.now());
    try {
      await api.request('POST', '/v1/keys/rotate', { entry, sealed });
      break;
    } catch (e) {
      if (!(e instanceof SyncHttpError && e.status === 409) || attempt === 3) throw e;
    }
  }
  keys.set(epoch, key);
  saveFamilyKeys(keys);
  return { epoch, key };
}

async function pushAll(api: SyncSession, settings: SyncSettings, { keys, epoch, closedAt }: Keys) {
  const key = keys.get(epoch)!;
  const meta = (id: string, kind: 'child' | 'log', row: Child | LogEntry) => ({
    id,
    kind,
    updatedAt: row.updatedAt,
    deviceId: settings.deviceId,
    deleted: row.isDeleted,
    // Lets the server delete photos no version uses any more.
    blobs: row.isDeleted ? [] : blobIdsOf(row),
  });
  let applied = false;
  let done = 0;
  // Rows too large for the server (a huge note): left pending and skipped, so they can't block everything else.
  const tooLarge = new Set<string>();
  // Rows the server called stale without sending a version that beats them: left pending for the next run.
  const held = new Set<string>();
  const notTooLarge = <T extends { id: SQLiteColumn }>(t: T) => {
    const skip = [...tooLarge, ...held];
    return skip.length ? [notInArray(t.id, skip)] : [];
  };

  for (;;) {
    // Children first, so a fresh device sees a child before its entries.
    const c = schema.childrenTable;
    const l = schema.logsTable;
    const children = await db.select().from(c).where(and(eq(c.syncStatus, 'pending'), ...notTooLarge(c))).limit(PUSH_BATCH);
    const logs = children.length < PUSH_BATCH
      ? await db.select().from(l).where(and(eq(l.syncStatus, 'pending'), ...notTooLarge(l))).limit(PUSH_BATCH - children.length)
      : [];
    if (!children.length && !logs.length) return { applied, tooLarge: tooLarge.size };

    // The rows now carry photo references the loaded stores don't have yet: reload them afterwards.
    if (await uploadPhotos(api, children, logs)) applied = true;
    const sealed: SyncRecord[] = [
      ...children.map((row) => sealRecord(key, epoch, meta(row.id, 'child', row), childToBody(row))),
      ...logs.map((row) => sealRecord(key, epoch, meta(row.id, 'log', row), logToBody(row))),
    ];
    const records = sealed.filter((r) => {
      if ((r.data?.length ?? 0) <= MAX_RECORD_CHARS) return true;
      console.warn(`[sync] ${r.kind} ${r.id} is too large to sync`);
      tooLarge.add(r.id);
      return false;
    });
    if (!records.length) continue;
    const version = new Map([...children, ...logs].map((r) => [r.id, r.updatedAt]));
    // The server takes at most MAX_REQUEST_BYTES per request: a batch of large notes goes up in several.
    for (const chunk of pushChunks(records)) {
      const res = await api.push(chunk);

      // The winning versions the server sent back for stale ones, of any epoch we hold, unless the log closed that
      // epoch before them. A stale row is settled only if one of them beats it; it's replaced below. Otherwise
      // (an older epoch's version this phone pulled long ago, or a server that withholds it) it stays pending.
      // Only versions that actually open and are well-formed count: the metadata alone is the server's word.
      const candidates = (res.newer ?? []).filter((r) => keys.has(r.epoch) && withinEpoch({ closedAt }, r.epoch, r.seq));
      const openedNewer = openAll(candidates, keys);
      const genuine = new Set<SyncRecord>(openedNewer.map((o) => o.record));
      const { settled, newer } = settlePush(chunk, res, (r) => genuine.has(r));
      // Pushed ids the server answered neither way are held too: each pass must leave the query smaller, or a
      // server could keep a phone pushing the same batch forever.
      const settledIds = new Set(settled);
      for (const r of chunk) if (!settledIds.has(r.id)) held.add(r.id);
      db.transaction((tx) => {
        for (const id of settled) {
          // Only if unchanged since it was read; an edit made meanwhile stays pending for the next round.
          const at = version.get(id)!;
          tx.update(schema.childrenTable).set({ syncStatus: 'synced' }).where(and(eq(schema.childrenTable.id, id), eq(schema.childrenTable.updatedAt, at))).run();
          tx.update(schema.logsTable).set({ syncStatus: 'synced' }).where(and(eq(schema.logsTable.id, id), eq(schema.logsTable.updatedAt, at))).run();
        }
      });
      if (newer.length) applied = applyOpened(openedNewer.filter((o) => (newer as SyncRecord[]).includes(o.record)), settings.deviceId) || applied;
      done += chunk.length;
      useSyncStore.setState({ progress: { label: 'Uploading', done } });
    }
  }
}

/** The server's limit on a record's ciphertext (base64url characters). */
const MAX_RECORD_CHARS = Math.ceil((MAX_RECORD_DATA * 4) / 3);

/**
 * Pulls every page since `since` and applies it. Returns whether anything changed locally. Records that can't be
 * genuine are skipped: a seq outside the page asked for, or one of an old epoch past the seq the log closed it at
 * (written with a key a removed phone still has, and stored by a server that shouldn't have).
 */
async function pullAll(api: SyncSession, settings: SyncSettings, { keys, closedAt }: Keys, since: number) {
  let seq = since;
  let applied = false;
  let done = 0;
  for (;;) {
    const page = await api.pull(seq);
    if (!pageContinues(seq, page)) throw new Error(`The server sent a page that doesn't continue from ${seq}`);
    const genuine = page.records.filter((r) => {
      if (r.seq > seq && r.seq <= page.seq && withinEpoch({ closedAt }, r.epoch, r.seq)) return true;
      console.warn(`[sync] refused ${r.kind} record ${r.id}: seq ${r.seq} isn't valid for epoch ${r.epoch}`);
      return false;
    });
    if (page.records.length) {
      applied = applyPage(genuine, keys, settings.deviceId) || applied;
      done += page.records.length;
      if (since === 0 || page.more) useSyncStore.setState({ progress: { label: 'Downloading', done } });
    }
    seq = page.seq;
    await saveSync({ lastSeq: seq });
    if (!page.more) return applied;
  }
}

/** Entries other phones wrote, applied during this run (for `notifyFamily`). */
let pulledLogs: PulledLog[] = [];
/** The first run after a move pulls everything again, all of it already here: no family notifications for it. */
let quiet = false;
export const quietNextRun = () => {
  quiet = true;
};

/** Decrypts, checks and applies one page (see `openAll` and `applyOpened`). */
function applyPage(records: SyncRecord[], keys: ReadonlyMap<number, Uint8Array>, ownDeviceId: string): boolean {
  return applyOpened(openAll(records, keys), ownDeviceId);
}

type Opened = { record: SyncRecord; body: ChildBody | LogBody | DeviceBody | MovedBody | null };

/**
 * Decrypts and checks records, before anything is written. A record of an epoch we have no key for throws, failing
 * the run (the next one fetches the key). One that doesn't open with a key we have (damaged or tampered with), one
 * that opens but is malformed (a buggy or hostile phone), or a tombstone nobody sealed (an older app's, or a
 * server's), is skipped, so a single bad record can't stop sync for good. Bodies come back as checked.
 */
function openAll(records: SyncRecord[], keys: ReadonlyMap<number, Uint8Array>): Opened[] {
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
function applyOpened(opened: Opened[], ownDeviceId: string): boolean {
  applyDeviceNames(opened.filter((o) => o.record.kind === 'device'));
  noteMove(opened.filter((o) => o.record.kind === 'moved'), ownDeviceId);
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
            photos.push(note.payload.type === 'note' ? note.payload.photoUri : undefined);
          }
          tx.update(schema.logsTable)
            .set({ isDeleted: true, payload: sql`json_object('type', ${schema.logsTable.logType})`, importRef: null, syncStatus: 'synced' })
            .where(eq(schema.logsTable.childId, r.id))
            .run();
        }
      } else if (r.deleted) {
        const old = local as LogEntry | undefined;
        if (!old) continue; // never had it; nothing to delete
        photos.push(old.payload.type === 'note' ? old.payload.photoUri : undefined);
        tx.update(schema.logsTable)
          .set({ isDeleted: true, payload: scrubbedPayload(old.logType), importRef: null, updatedAt: r.updatedAt, syncStatus: 'synced' })
          .where(eq(schema.logsTable.id, r.id))
          .run();
        if (r.deviceId !== ownDeviceId) pulledLogs.push({ before: old, after: { ...old, isDeleted: true }, deviceId: r.deviceId });
      } else {
        const row = bodyToLog(r.id, body as LogBody, r, local as LogEntry | undefined);
        tx.insert(schema.logsTable).values(row).onConflictDoUpdate({ target: schema.logsTable.id, set: row }).run();
        const old = local as LogEntry | undefined;
        if (r.deviceId !== ownDeviceId) pulledLogs.push({ before: old ?? null, after: row, deviceId: r.deviceId });
        const oldPhoto = old?.payload.type === 'note' ? old.payload.photoUri : undefined;
        if (oldPhoto && oldPhoto !== (row.payload.type === 'note' ? row.payload.photoUri : undefined)) photos.push(oldPhoto);
      }
    }
  });

  for (const uri of photos) deletePhoto(uri ?? undefined);
  return changed;
}

/** A sensible default name for this phone in the family's list, e.g. "Pixel 10". */
export const defaultDeviceName = () => Device.modelName ?? Device.deviceName ?? 'Phone';

/** A phone's display name, as its encrypted `device` record (id = that phone's device id). */
export type DeviceBody = { name: string };

function applyDeviceNames(records: { record: SyncRecord; body: unknown }[]) {
  if (!records.length) return;
  const names = { ...syncSettings()?.names };
  for (const { record, body } of records) {
    if (record.deleted) delete names[record.id];
    else names[record.id] = (body as DeviceBody).name;
  }
  saveSync({ names });
}

/** Another phone moved the family to another server: remember where, and follow on the next round (`followMove`). */
function noteMove(records: Opened[], ownDeviceId: string) {
  const current = syncSettings();
  for (const { record, body } of records) {
    const moved = body as MovedBody | null;
    if (record.deleted || !moved || !current || record.deviceId === ownDeviceId || moved.from !== record.deviceId || moved.familyId === current.familyId) continue;
    saveSync({ move: moved });
  }
}

/** Publishes a phone's name to the family (this phone's at setup, join and rename). */
export async function pushDeviceName(name: string, deviceId?: string) {
  const settings = syncSettings();
  if (!settings) return;
  const api = sessionFor(settings);
  const { keys, epoch } = await refreshKeys(api);
  const id = deviceId ?? settings.deviceId;
  const meta = { id, kind: 'device' as const, updatedAt: Date.now(), deviceId: settings.deviceId, deleted: false };
  await api.push([sealRecord(keys.get(epoch)!, epoch, meta, { name } satisfies DeviceBody)]);
  await saveSync({ names: { ...settings.names, [id]: name } });
}

async function reloadStores() {
  await useChildStore.getState().hydrate();
  const settings = useSettingsStore.getState();
  const children = useChildStore.getState().children;
  // The active child may have been deleted on another phone, or this phone had none yet.
  const active = children.find((c) => c.id === settings.activeChildId) ?? children[0];
  if (active && active.id !== settings.activeChildId) await settings.set('activeChildId', active.id);
  if (active) await useLogStore.getState().loadLogs(active.id);
}

// --- live notifications -----------------------------------------------------------------------------------

let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;

/** While the app is open: the server pings on every change, and this phone pulls right away. */
export async function openLive() {
  const settings = syncSettings();
  if (!settings || socket) return;
  try {
    const url = await sessionFor(settings).liveUrl();
    socket = new WebSocket(url);
    socket.onopen = () => (attempts = 0);
    socket.onmessage = () => requestSync(300);
    socket.onclose = (e) => {
      socket = null;
      if (e.code === 4401 || !syncSettings()) return;
      // Reconnect with backoff (phones lose connections all the time).
      retry = setTimeout(openLive, Math.min(30_000, 1000 * 2 ** attempts++));
    };
  } catch {
    retry = setTimeout(openLive, Math.min(30_000, 1000 * 2 ** attempts++));
  }
}

export function closeLive() {
  if (retry) clearTimeout(retry);
  retry = null;
  const s = socket;
  socket = null;
  if (s) {
    s.onclose = null;
    s.close();
  }
}
