import { t } from '@subby/shared/i18n';
import { errorMessage } from '../errorMessage';
import * as Device from 'expo-device';
import { and, count, eq, notInArray } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { uuidv7 } from 'uuidv7';
import type { Child, LogEntry } from '@subby/shared';
import {
  RECOVERY_SIGNER,
  appendEntry,
  assertLogContinues,
  belowFloors,
  entriesToRestore,
  fromBase64,
  newSymmetricKey,
  openFamilyKey,
  verifyDeviceLog,
  withinEpoch,
  type DeviceLogEntry,
  type DeviceLogState,
  type RestoreFloor,
} from '@subby/shared/crypto';
import { MAX_RECORD_DATA, pageContinues, pushChunks, serverWentBack, settlePush, sealRecord, type SyncRecord } from '@subby/shared/sync';
import { db, schema } from '../../db/client';
import { markAllPending } from './pending';
import { useChildStore } from '../../store/useChildStore';
import { useLogStore } from '../../store/useLogStore';
import { activeChildOf } from '../../store/useActiveChild';
import { useSettingsStore, type SyncSettings } from '../../store/useSettingsStore';
import { checkServer, createFamily, isHttpError, normalizeServerUrl, sealEpochs, sealTo, SyncHttpError, SyncSession } from './api';
import { notifyFamily } from '../reminders/family';
import { clearSyncSecrets, deviceIdentity, loadFamilyKeys, saveFamilyKeys } from './keystore';
import { blobIdsOf, childToBody, logToBody } from './records';
import { downloadPhotos, forgetPhotoUploads, queueUnsyncedPhotos, uploadPhotos, uploadPhotosAsTheyAre } from './photos';
import { canWrite, forgetAccess, refreshEntitlement, useAccessStore } from './access';
import { cancelInactivityWarning, planInactivityWarning } from './inactivity';
import { followMove } from './move';
import { applyOpened, applyPage, openAll, quietNextRun, takePulledLogs, type DeviceBody } from './apply';
import { closeLive } from './live';
import { INITIAL_STATUS, dropSession, newSyncSettings, saveSync, sessionFor, syncSettings, useSyncStore } from './state';

/** Rows per push request (a batch of large notes is split further by `pushChunks`). */
const PUSH_BATCH = 500;

/** The server's limit on a record's ciphertext (base64url characters). */
const MAX_RECORD_CHARS = Math.ceil((MAX_RECORD_DATA * 4) / 3);


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
  await createFamily(server, { familyId, entry, sealedKey: sealTo(identity.box.publicKey, familyKey) });

  saveFamilyKeys(new Map([[1, familyKey]]));
  // Everything on this phone goes up, including deletions made before sync existed, and photos to this family.
  await markAllPending();
  await forgetPhotoUploads();
  await useSettingsStore
    .getState()
    .set('sync', newSyncSettings({ server, familyId, deviceId, knownDevices: [deviceId], logSeen: { length: 1, head: verifyDeviceLog([entry]).head } }));
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

/** After switching servers (a move): the next request logs in to the new one, and live reconnects there. */
export function forgetSession() {
  closeLive();
  forgetAccess();
  dropSession();
}

async function forgetSync() {
  forgetSession();
  await cancelInactivityWarning();
  await useSettingsStore.getState().set('sync', null);
  await clearSyncSecrets();
  // The last error stays for support (diagnostics); everything else goes back to what an unset-up phone has.
  useSyncStore.setState({ ...INITIAL_STATUS, lastError: useSyncStore.getState().lastError });
}

async function leaveFamily(settings: SyncSettings) {
  const api = sessionFor(settings);
  const { entries, state } = await refreshMembers(api, settings);
  const me = { id: settings.deviceId, keys: deviceIdentity() };
  const entry = appendEntry(state, entries.length, me, { type: 'remove', deviceId: settings.deviceId }, Date.now());
  await api.appendLog(entry);
}

// --- one sync run -----------------------------------------------------------------------------------------

let running: Promise<void> | null = null;
let again = false; // a request that came in during a run: one more run after it

/** Runs a sync now, or once more right after the current one finishes. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      // `again` (a request during the run) and the run's own answer (it followed a move, or the server was restored).
      for (let repeat = true; repeat; ) {
        again = false;
        repeat = (await runOnce()) || again;
      }
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

/** One run. Returns whether another should follow right away (it followed a move, noted one, or restarted after a restore). */
async function runOnce(): Promise<boolean> {
  const settings = syncSettings();
  if (!settings) {
    useSyncStore.setState({ phase: 'off' });
    return false;
  }
  useSyncStore.setState({ phase: 'syncing', error: null });
  try {
    // Another phone moved the family: follow it before anything else touches the old one.
    if (settings.move) {
      useSyncStore.setState({ progress: { label: t('sync.progress.moving'), done: 0 } });
      await followMove(settings, settings.move);
      return true;
    }
    const api = sessionFor(settings);
    let { entries, state } = await refreshMembers(api, settings);
    let keys = await refreshKeys(api, state);
    // Finish what a phone left half done (a grant or a rotation), then work with the result.
    let restarted = false;
    const healed = await heal(api, settings, entries, state, keys);
    if (healed.changed) {
      restarted = healed.again;
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
    const pulled = await pullAll(api, settings, keys, syncSettings()?.lastSeq ?? settings.lastSeq);
    const applied = pulled.applied || pushed.applied;
    restarted ||= pulled.again;
    const photos = await downloadPhotos(api, (done) => useSyncStore.setState({ progress: { label: t('sync.progress.photos'), done } }));
    // Phones set up before names existed (or whose name record was lost) name themselves once.
    if (!syncSettings()?.names?.[settings.deviceId] && canWrite()) await pushDeviceName(defaultDeviceName());
    await saveSync({ lastSyncedAt: Date.now() });
    if (applied || photos) await reloadStores();
    await notifyFamily(takePulledLogs()).catch((e) => console.warn('Family notifications failed', e)); // i18n-ignore
    await planInactivityWarning(useAccessStore.getState().entitlement?.inactiveDays).catch((e) => console.warn('Planning the inactivity warning failed', e)); // i18n-ignore
    useSyncStore.setState({ phase: 'idle', error: null, removed: false, progress: null, pending: await pendingCount(), tooLarge: pushed.tooLarge });
    // A pulled `moved` record: the next round follows it.
    return restarted || Boolean(syncSettings()?.move);
  } catch (e) {
    const removed = isRemoved(e);
    const message = removed ? t('sync.error.removed') : errorMessage(e);
    useSyncStore.setState({ phase: 'error', error: message, lastError: { message, at: Date.now() }, removed, progress: null, pending: await pendingCount() });
    throw e;
  }
}

/** Pushes; a 402 (the trial or grace just ended) only means this phone's changes wait for an unlock. */
async function pushUnlessLocked(api: SyncSession, settings: SyncSettings, keys: Keys) {
  try {
    return await pushAll(api, settings, keys);
  } catch (e) {
    if (!isHttpError(e, 402)) throw e;
    await refreshEntitlement(api);
    return { applied: false, tooLarge: 0 };
  }
}

/** A removed device can't log in any more (its sessions and membership are gone). */
export const isRemoved = (e: unknown) =>
  isHttpError(e, 401) || (isHttpError(e, 404) && /unknown device/i.test(e.message));

/**
 * Verifies the signed device log (a server can't add phones on its own, nor serve an older log than this phone
 * saw) and publishes the members. Phones that weren't there last time are flagged once, so a parent notices a
 * phone they didn't add.
 */
export async function refreshMembers(api: SyncSession, settings: SyncSettings) {
  let { entries } = await api.log();
  // The server lost entries this phone verified (it was restored from a backup): give them back as they were
  // signed. The server checks they continue its log; anything else still fails below.
  const lost = entriesToRestore(entries, syncSettings()?.log);
  if (lost) {
    console.warn(`[sync] the server lost ${lost.length} phone list entries; giving them back`);
    await api.restoreLog(lost);
    ({ entries } = await api.log());
  }
  // Read after the last await: another call (a rename's key refresh) may have seen, and saved, a longer log meanwhile,
  // and checking against an older copy would let this one save a shorter log over it.
  const saved = syncSettings();
  assertLogContinues(entries, saved?.logSeen ?? settings.logSeen);
  const state = verifyDeviceLog(entries);
  if (saved?.logSeen?.length !== entries.length || saved?.log?.length !== entries.length) {
    await saveSync({ logSeen: { length: entries.length, head: state.head }, log: entries });
  }
  if (!state.members.has(settings.deviceId)) throw new SyncHttpError(401, 'Removed'); // i18n-ignore
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
  if (!keys.has(log.epoch)) throw new Error(t('sync.error.noKey'));
  return { keys, epoch: log.epoch, missing: res.missing ?? [], closedAt: log.closedAt };
}

type Keys = Awaited<ReturnType<typeof refreshKeys>>;

/**
 * Finishes what another phone (or this one) left half done: grants epochs a member lacks, sealed only to keys from
 * the verified log, and starts the epoch the log says is owed (after a removal or a replaced recovery key).
 * Returns whether it changed anything, and whether the run should start over (`again`). A rotation another phone made first is fine.
 */
async function heal(api: SyncSession, settings: SyncSettings, entries: DeviceLogEntry[], state: DeviceLogState, { keys, missing }: Keys) {
  let changed = false;
  let again = false;
  for (const { recipient, epochs } of missing) {
    const member = recipient === RECOVERY_SIGNER ? state.recovery : state.members.get(recipient);
    const held = epochs.filter((e) => keys.has(e));
    if (!member || !held.length) continue;
    await api.grant(recipient, sealEpochs(member.boxKey, held.map((epoch): [number, Uint8Array] => [epoch, keys.get(epoch)!])));
    changed = true;
  }
  if (state.rotationDue) {
    try {
      again = (await rotateKeys(api, settings, entries, state, keys)).again;
    } catch (e) {
      // Another phone rotated at the same moment: its epoch counts.
      if (!isHttpError(e, 400, 409)) throw e;
    }
    changed = true;
  }
  return { changed, again };
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
  for (const [id, m] of state.members) sealed[id] = sealTo(m.boxKey, key);
  if (state.recovery) sealed[RECOVERY_SIGNER] = sealTo(state.recovery.boxKey, key);
  const current: Keys = { keys, epoch: state.epoch, missing: [], closedAt: state.closedAt };
  let again = false;
  for (let attempt = 1; ; attempt++) {
    const pulled = await pullAll(api, settings, current, syncSettings()?.lastSeq ?? 0);
    again ||= pulled.again;
    if (pulled.applied) await reloadStores();
    const closedSeq = syncSettings()?.lastSeq ?? 0;
    const entry = appendEntry(state, entries.length, me, { type: 'epoch', deviceId: me.id, familyKey: { epoch, key }, closedSeq }, Date.now());
    try {
      await api.rotate(entry, sealed);
      break;
    } catch (e) {
      if (!isHttpError(e, 409) || attempt === 3) throw e;
    }
  }
  keys.set(epoch, key);
  saveFamilyKeys(keys);
  return { epoch, key, again };
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
  const unlessSkipped = <T extends { id: SQLiteColumn }>(t: T) => {
    const skip = [...tooLarge, ...held];
    return skip.length ? [notInArray(t.id, skip)] : [];
  };

  for (;;) {
    // Children first, so a fresh device sees a child before its entries.
    const c = schema.childrenTable;
    const l = schema.logsTable;
    const children = await db.select().from(c).where(and(eq(c.syncStatus, 'pending'), ...unlessSkipped(c))).limit(PUSH_BATCH);
    const logs = children.length < PUSH_BATCH
      ? await db.select().from(l).where(and(eq(l.syncStatus, 'pending'), ...unlessSkipped(l))).limit(PUSH_BATCH - children.length)
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
      const candidates = (res.newer ?? []).filter((r) => keys.has(r.epoch) && genuineAt(closedAt, r.epoch, r.seq));
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
      if (newer.length) applied = (await applyOpened(openedNewer.filter((o) => (newer as SyncRecord[]).includes(o.record)), settings.deviceId)) || applied;
      done += chunk.length;
      useSyncStore.setState({ progress: { label: t('sync.progress.uploading'), done } });
    }
  }
}

/**
 * Pulls every page since `since` and applies it. Returns whether anything changed locally. Records that can't be
 * genuine are skipped: a seq outside the page asked for, or one of an old epoch past the seq the log closed it at
 * (written with a key a removed phone still has, and stored by a server that shouldn't have).
 */
async function pullAll(api: SyncSession, settings: SyncSettings, { keys, epoch, closedAt }: Keys, since: number): Promise<{ applied: boolean; again: boolean }> {
  let seq = since;
  let applied = false;
  let again = false;
  let done = 0;
  for (;;) {
    const page = await api.pull(seq);
    const gen = page.restored?.gen ?? 0;
    const seenGen = syncSettings()?.restoreGen ?? 0;
    // Restored from a backup (or behind this phone without saying so): the server gets back what it lost, and
    // pulling starts over. A pull from 0 (a new phone, or right after this) just notes the count.
    if (seq > 0 && (gen !== seenGen || serverWentBack(seq, page))) {
      await resyncAfterRestore(api, { epoch, seq: gen !== seenGen ? (page.restored?.seq ?? 0) : page.seq }, gen);
      seq = 0;
      applied = true;
      again = true;
      continue;
    }
    if (gen !== seenGen) await saveSync({ restoreGen: gen });
    if (!pageContinues(seq, page)) throw new Error(t('sync.error.pageStalled', { seq: String(seq) }));
    const genuine = page.records.filter((r) => {
      if (r.seq > seq && r.seq <= page.seq && genuineAt(closedAt, r.epoch, r.seq)) return true; // i18n-ignore
      console.warn(`[sync] refused ${r.kind} record ${r.id}: seq ${r.seq} isn't valid for epoch ${r.epoch}`);
      return false;
    });
    if (page.records.length) {
      applied = (await applyPage(genuine, keys, settings.deviceId)) || applied;
      done += page.records.length;
      if (since === 0 || page.more) useSyncStore.setState({ progress: { label: t('sync.progress.downloading'), done } });
    }
    seq = page.seq;
    await saveSync({ lastSeq: seq });
    if (!page.more) return { applied, again };
  }
}

/** A record of `epoch` at `seq` can be genuine: within what the log let that epoch have, and below every restore's floor. */
const genuineAt = (closedAt: DeviceLogState['closedAt'], epoch: number, seq: number) =>
  withinEpoch({ closedAt }, epoch, seq) && belowFloors(syncSettings()?.floors, epoch, seq);

/**
 * The server was restored from a backup (or lost data without saying so): it gets back from this phone what it
 * lost. Every photo goes up again under its id and key (ones it still has are skipped), then every row is marked
 * pending for the next run to push, and this phone's name with it; pulling starts over from 0. Old-key records
 * past the restore's seq were written after the backup by a phone the log had already removed (`floor`).
 * Each step is safe to repeat: until the new count is saved, the next run starts here again.
 */
async function resyncAfterRestore(api: SyncSession, floor: RestoreFloor, gen: number) {
  console.warn(`[sync] the server was restored from a backup (count ${gen}, seq ${floor.seq}); syncing everything again`);
  useSyncStore.setState({ progress: { label: t('sync.progress.restoring'), done: 0 } });
  await uploadPhotosAsTheyAre(api, (done) => useSyncStore.setState({ progress: { label: t('sync.progress.restoring'), done } }), true);
  await markAllPending();
  const settings = syncSettings()!;
  const name = settings.names?.[settings.deviceId];
  if (name && canWrite()) await pushDeviceName(name);
  quietNextRun();
  await saveSync({ lastSeq: 0, restoreGen: gen, floors: [...(settings.floors ?? []), floor] });
}
/** A sensible default name for this phone in the family's list, e.g. "Pixel 10". */
export const defaultDeviceName = () => Device.modelName ?? Device.deviceName ?? t('sync.phone');

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
  const active = activeChildOf(children, settings.activeChildId);
  if (active && active.id !== settings.activeChildId) await settings.set('activeChildId', active.id);
  if (active) await useLogStore.getState().loadLogs(active.id);
}

