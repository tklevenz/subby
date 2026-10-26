import { create } from 'zustand';
import * as Device from 'expo-device';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Child, LogEntry } from '@kindred-log/shared';
import { appendEntry, fromBase64, newSymmetricKey, openSealed, seal, toBase64, verifyDeviceLog } from '@kindred-log/shared/crypto';
import { clientApplies, openRecord, sealRecord, type SyncRecord } from '@kindred-log/shared/sync';
import { db, schema } from '../../db/client';
import { deletePhoto } from '../photos';
import { useChildStore } from '../../store/useChildStore';
import { useLogStore } from '../../store/useLogStore';
import { useSettingsStore, type SyncSettings } from '../../store/useSettingsStore';
import { checkServer, createFamily, normalizeServerUrl, SyncHttpError, SyncSession } from './api';
import { clearSyncSecrets, deviceIdentity, loadFamilyKeys, saveFamilyKeys } from './keystore';
import { blobIdsOf, bodyToChild, bodyToLog, childToBody, childTombstone, logToBody, scrubbedPayload, type ChildBody, type LogBody } from './records';
import { downloadPhotos, forgetPhotoUploads, queueUnsyncedPhotos, uploadPhotos } from './photos';

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
};

export const useSyncStore = create<SyncStatus>(() => ({ phase: 'off', error: null, pending: 0, progress: null, members: [], newDevices: [], removed: false, hasRecovery: false }));

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
  const entry = appendEntry(null, 0, { id: deviceId, keys: identity }, { type: 'create', deviceId, keys }, Date.now());
  const familyKey = newSymmetricKey();
  await createFamily(server, { familyId, entry, sealedKey: toBase64(seal(identity.box.publicKey, familyKey)) });

  saveFamilyKeys(new Map([[1, familyKey]]));
  // Everything on this phone goes up, including deletions made before sync existed, and photos to this family.
  await db.update(schema.childrenTable).set({ syncStatus: 'pending' });
  await db.update(schema.logsTable).set({ syncStatus: 'pending' });
  await forgetPhotoUploads();
  await useSettingsStore
    .getState()
    .set('sync', { server, familyId, deviceId, lastSeq: 0, lastSyncedAt: null, knownDevices: [deviceId], photosFamily: familyId });
  await pushDeviceName(deviceName);
  requestSync(0);
}

/** Stops syncing on this phone. Local data stays; this phone's keys are forgotten. */
export async function turnOffSync() {
  const settings = syncSettings();
  // Leave the family properly when the server is reachable; offline, the other phones can remove this one.
  if (settings) await leaveFamily(settings).catch(() => {});
  closeLive();
  session = null;
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
    const api = sessionFor(settings);
    await refreshMembers(api, settings);
    const keys = await refreshKeys(api);
    // A phone moved to another family before photo references were tracked: re-upload its own photos once.
    if (settings.photosFamily !== settings.familyId) {
      await forgetPhotoUploads({ onlyLocal: true });
      await saveSync({ photosFamily: settings.familyId });
    }
    await queueUnsyncedPhotos();
    const { stale } = await pushAll(api, settings, keys);
    // A stale push means the server has a newer version we may have skipped: read everything again.
    const applied = await pullAll(api, settings, keys, stale ? 0 : settings.lastSeq);
    const photos = await downloadPhotos(api, (done) => useSyncStore.setState({ progress: { label: 'Downloading photos', done } }));
    // Phones set up before names existed (or whose name record was lost) name themselves once.
    if (!syncSettings()?.names?.[settings.deviceId]) await pushDeviceName(defaultDeviceName());
    await saveSync({ lastSyncedAt: Date.now() });
    if (applied || photos) await reloadStores();
    useSyncStore.setState({ phase: 'idle', error: null, removed: false, progress: null, pending: await pendingCount() });
  } catch (e) {
    const removed = isRemoved(e);
    const message = removed ? 'This phone was removed from the family' : e instanceof Error ? e.message : String(e);
    useSyncStore.setState({ phase: 'error', error: message, removed, progress: null, pending: await pendingCount() });
    throw e;
  }
}

/** A removed device can't log in any more (its sessions and membership are gone). */
export const isRemoved = (e: unknown) =>
  e instanceof SyncHttpError && (e.status === 401 || (e.status === 404 && /unknown device/i.test(e.message)));

/**
 * Verifies the signed device log (a server can't add phones on its own) and publishes the members.
 * Phones that weren't there last time are flagged once, so a parent notices a phone they didn't add.
 */
export async function refreshMembers(api: SyncSession, settings: SyncSettings) {
  const { entries } = await api.log();
  const state = verifyDeviceLog(entries);
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

/** Opens any family keys sealed to this device that it doesn't have yet (new epochs after a removal). */
export async function refreshKeys(api: SyncSession) {
  const keys = loadFamilyKeys();
  const res = await api.keys();
  let changed = false;
  for (const k of res.keys) {
    if (keys.has(k.epoch)) continue;
    keys.set(k.epoch, openSealed(deviceIdentity(), fromBase64(k.sealed)));
    changed = true;
  }
  if (changed) saveFamilyKeys(keys);
  if (!keys.has(res.currentEpoch)) throw new Error('Missing the current family key');
  return { keys, epoch: res.currentEpoch };
}

type Keys = Awaited<ReturnType<typeof refreshKeys>>;

async function pushAll(api: SyncSession, settings: SyncSettings, { keys, epoch }: Keys) {
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
  let stale = false;
  let done = 0;

  for (;;) {
    // Children first, so a fresh device sees a child before its entries.
    const children = await db.select().from(schema.childrenTable).where(eq(schema.childrenTable.syncStatus, 'pending')).limit(PUSH_BATCH);
    const logs = children.length < PUSH_BATCH
      ? await db.select().from(schema.logsTable).where(eq(schema.logsTable.syncStatus, 'pending')).limit(PUSH_BATCH - children.length)
      : [];
    if (!children.length && !logs.length) return { stale };

    await uploadPhotos(api, children, logs);
    const records: SyncRecord[] = [
      ...children.map((c) => sealRecord(key, epoch, meta(c.id, 'child', c), childToBody(c))),
      ...logs.map((l) => sealRecord(key, epoch, meta(l.id, 'log', l), logToBody(l))),
    ];
    const res = await api.push(records);
    if (res.stale.length) stale = true;

    // Stale ones are marked synced too: the server's newer version replaces them on the pull.
    const settled = new Set([...res.accepted, ...res.stale]);
    const version = new Map([...children, ...logs].map((r) => [r.id, r.updatedAt]));
    db.transaction((tx) => {
      for (const id of settled) {
        // Only if unchanged since it was read; an edit made meanwhile stays pending for the next round.
        const at = version.get(id)!;
        tx.update(schema.childrenTable).set({ syncStatus: 'synced' }).where(and(eq(schema.childrenTable.id, id), eq(schema.childrenTable.updatedAt, at))).run();
        tx.update(schema.logsTable).set({ syncStatus: 'synced' }).where(and(eq(schema.logsTable.id, id), eq(schema.logsTable.updatedAt, at))).run();
      }
    });
    done += records.length;
    useSyncStore.setState({ progress: { label: 'Uploading', done } });
  }
}

/** Pulls every page since `since` and applies it. Returns whether anything changed locally. */
async function pullAll(api: SyncSession, settings: SyncSettings, { keys }: Keys, since: number) {
  let seq = since;
  let applied = false;
  let done = 0;
  for (;;) {
    const page = await api.pull(seq);
    if (page.records.length) {
      applied = applyPage(page.records, keys, settings.deviceId) || applied;
      done += page.records.length;
      if (since === 0 || page.more) useSyncStore.setState({ progress: { label: 'Downloading', done } });
    }
    seq = page.seq;
    await saveSync({ lastSeq: seq });
    if (!page.more) return applied;
  }
}

/** Applies one page in a transaction. Newer local edits that aren't pushed yet win (same rule as the server). */
function applyPage(records: SyncRecord[], keys: ReadonlyMap<number, Uint8Array>, ownDeviceId: string): boolean {
  // Decrypt first: a record we can't open fails the run before anything is written.
  const opened = records.map((r) => ({ record: r, body: openRecord<ChildBody | LogBody | DeviceBody>(keys, r) }));
  applyDeviceNames(opened.filter((o) => o.record.kind === 'device'));
  const photos: (string | null | undefined)[] = [];
  let changed = false;

  db.transaction((tx) => {
    const childIds = records.filter((r) => r.kind === 'child').map((r) => r.id);
    const logIds = records.filter((r) => r.kind === 'log').map((r) => r.id);
    const localChildren = new Map(
      (childIds.length ? tx.select().from(schema.childrenTable).where(inArray(schema.childrenTable.id, childIds)).all() : []).map((c) => [c.id, c]),
    );
    const localLogs = new Map(
      (logIds.length ? tx.select().from(schema.logsTable).where(inArray(schema.logsTable.id, logIds)).all() : []).map((l) => [l.id, l]),
    );

    for (const { record: r, body } of opened) {
      if (r.kind === 'device') continue; // names, applied above
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
      } else {
        const row = bodyToLog(r.id, body as LogBody, r, local as LogEntry | undefined);
        tx.insert(schema.logsTable).values(row).onConflictDoUpdate({ target: schema.logsTable.id, set: row }).run();
        const old = local as LogEntry | undefined;
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
