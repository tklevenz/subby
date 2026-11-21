import { t } from '@subby/shared/i18n';
import { errorMessage } from '../errorMessage';
import { uuidv7 } from 'uuidv7';
import {
  RECOVERY_SIGNER,
  appendEntry,
  assertLogContinues,
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
import { markAllPending } from './pending';
import { useSettingsStore, type SyncSettings } from '../../store/useSettingsStore';
import { checkServer, createFamily, isHttpError, normalizeServerUrl, NotSubbyError, sealTo, serverLabel, SyncSession } from './api';
import { deviceIdentity, saveFamilyKeys } from './keystore';
import { setUpBackgroundSync } from './background';
import { uploadPhotosAsTheyAre } from './photos';
import { forgetSession, pushDeviceName, refreshKeys, refreshMembers, requestSync, syncNow } from './engine';
import { quietNextRun } from './apply';
import { openLive } from './live';
import { saveSync, sessionFor, syncSettings, useSyncStore } from './state';

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
  if (!old) throw new Error(t('sync.error.notSetUp'));
  const server = normalizeServerUrl(serverInput);
  if (server === normalizeServerUrl(old.server)) throw new Error(t('sync.error.sameServer'));
  await checkServer(server);

  // Everything of the old family is here first: this phone's copy is what moves.
  onStep(t('sync.move.syncing'));
  await syncNow();
  if (useSyncStore.getState().phase === 'error') throw new Error(useSyncStore.getState().error ?? t('sync.error.currentServer'));
  const settings = syncSettings()!;
  const oldApi = sessionFor(settings);
  const { entries: oldEntries, state: oldState } = await refreshMembers(oldApi, settings);
  const { keys: oldKeys, epoch: oldEpoch } = await refreshKeys(oldApi, oldState);

  onStep(t('sync.move.setUp'));
  const me = { id: settings.deviceId, keys: deviceIdentity() };
  const familyId = uuidv7();
  const familyKey = newSymmetricKey();
  const log = movedFamilyLog(oldState, me, familyKey, Date.now());
  try {
    await createFamily(server, { familyId, entry: log[0]!, sealedKey: toBase64(seal(me.keys.box.publicKey, familyKey)) });
  } catch (e) {
    if (isHttpError(e, 409)) throw new Error(t('sync.error.alreadyThere'));
    throw e;
  }
  const api = new SyncSession(server, me.id, me.keys);
  try {
    for (const entry of log.slice(1)) await api.appendLog(entry);
    const newState = verifyDeviceLog(log);
    for (const [id, m] of newState.members) {
      if (id !== me.id) await api.grant(id, [{ epoch: 1, sealed: sealTo(m.boxKey, familyKey) }]);
    }
    if (newState.recovery) {
      await api.grant(RECOVERY_SIGNER, [{ epoch: 1, sealed: sealTo(newState.recovery.boxKey, familyKey) }]);
    }
    await uploadPhotosAsTheyAre(api, (done) => onStep(t('sync.move.photos', { count: done })));

    // The old family learns where it went. Sealed with its key, so its server can't point the phones elsewhere.
    const moved: MovedBody = { server, familyId, from: me.id, seq: settings.lastSeq, entries: log.length };
    await oldApi.push([sealRecord(oldKeys.get(oldEpoch)!, oldEpoch, { id: familyId, kind: 'moved', updatedAt: Date.now(), deviceId: me.id, deleted: false }, moved)]);
  } catch (e) {
    // Nothing points at the new family yet: take it down again, so a retry starts clean.
    await api.deleteFamily().catch(() => {});
    throw e;
  }

  onStep(t('sync.move.entries'));
  await switchTo(settings, { server, familyId, entries: log, keys: new Map([[1, familyKey]]), members: [...verifyDeviceLog(log).members.keys()], markAllPending: true });
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
    // Never from HTTPS to plain HTTP: a phone of the family (or its key in the wrong hands) can't lead the others to
    // a server anyone on the way can read.
    if (/^https:/i.test(settings.server) && !/^https:/i.test(move.server)) throw new MoveRefused(t('sync.error.moveInsecure'));
    const { entries: oldEntries } = await oldApi.log();
    // The old server can't hide a removal behind an older list than this phone already saw.
    assertLogContinues(oldEntries, settings.logSeen);
    // Not a Subby server at that address: no retry will change that. (One that needs a newer app may work after an
    // update, and an unreachable one later: those are tried again.)
    await checkServer(move.server).catch((e: unknown) => {
      throw e instanceof NotSubbyError ? new MoveRefused(e.message) : e;
    });
    const login = await api.login().catch((e: unknown) => {
      // Refused for good: not a member there (the family is gone, or never had this phone), or a request the server
      // can't take. A 401 can be a challenge that expired on the way, so it's tried again.
      throw isHttpError(e, 400, 403, 404, 405) ? new MoveRefused(errorMessage(e)) : e;
    });
    if (login.familyId !== move.familyId) throw new MoveRefused(t('sync.error.otherFamily'));
    const { entries } = await api.log();
    const state = refused(() => verifyMovedLog(oldEntries, entries, move.from, me.id, move.entries));
    const res = await api.keys();
    const sealed = res.keys.find((k) => k.epoch === state.epoch);
    if (!sealed) throw new Error(t('sync.error.newServerNoKey'));
    const keys = new Map(res.keys.map((k) => [k.epoch, refused(() => openFamilyKey(me.keys, state, k.epoch, fromBase64(k.sealed)))]));

    // What this phone wrote to the old family after the mover's last pull isn't in the new one yet.
    const own: string[] = [];
    for (let since = move.seq; ; ) {
      const page = await oldApi.pull(since);
      own.push(...page.records.filter((r) => r.deviceId === me.id && (r.kind === 'child' || r.kind === 'log')).map((r) => r.id));
      if (!page.more || page.seq <= since) break;
      since = page.seq;
    }
    await markAllPending(own);

    await switchTo(settings, { server: move.server, familyId: move.familyId, entries, keys, members: [...state.members.keys()], markAllPending: false });
    await leave(oldApi, oldEntries, me);
    useSyncStore.setState({ movedTo: move.server });
  } catch (e) {
    // A move that can never work (it doesn't check out, or the family isn't there) is dropped, so this phone goes
    // on syncing with the family it's in, and it won't be taken up again. Anything else is tried again next run.
    if (e instanceof MoveRefused) {
      console.warn('[sync] refused to follow a move:', e.message);
      await saveSync({ move: undefined, refusedMoves: [...(syncSettings()?.refusedMoves ?? []), move.familyId].slice(-20) });
    }
    // Not "removed": that's about the old family, which this phone is still in.
    const why = errorMessage(e);
    throw new Error(t('sync.error.followFailed', { server: serverLabel(move.server), why }));
  }
}

/** A move this phone won't follow, whatever happens next (see `followMove`). */
class MoveRefused extends Error {}

/** Runs a check whose failure means the move can't be genuine. */
function refused<T>(check: () => T): T {
  try {
    return check();
  } catch (e) {
    throw new MoveRefused(errorMessage(e));
  }
}

/** Settings that belong to the old server: its log copy, restore count, floors and resync time, the epochs pulled (the new family's start at 1), push registration, and the move note itself. */
const OLD_SERVER_ONLY = ['move', 'pushToken', 'push', 'log', 'restoreGen', 'floors', 'pulledEpochs', 'resyncedAt'] as const;

const omit = <T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> => {
  const copy = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
};

/** Points this phone at the new family: its keys, server and log; every row of it then syncs there. */
async function switchTo(
  settings: SyncSettings,
  next: { server: string; familyId: string; entries: DeviceLogEntry[]; keys: Map<number, Uint8Array>; members: string[]; markAllPending: boolean },
) {
  saveFamilyKeys(next.keys);
  // The mover sends everything it has; a follower only what the mover can't have (marked pending before this).
  if (next.markAllPending) await markAllPending();
  const kept = omit(settings, OLD_SERVER_ONLY);
  forgetSession();
  quietNextRun();
  await useSettingsStore.getState().set('sync', {
    ...kept,
    server: next.server,
    familyId: next.familyId,
    lastSeq: 0,
    // Kept, not the new family's list: a phone the new server's family has and this one never saw is pointed out
    // ("New phone in your family") on the next run, as on the old server.
    knownDevices: settings.knownDevices ?? next.members,
    // Photo references stay valid: the blobs are on the new server under the same ids and keys.
    photosFamily: next.familyId,
    logSeen: { length: next.entries.length, head: verifyDeviceLog(next.entries).head },
  });
  void openLive(() => requestSync(300));
  setUpBackgroundSync().catch((e: unknown) => console.warn('[sync] background setup after the move failed', e));
  requestSync(0);
}

/** Leaves the old family by itself (best effort); the last phone leaving deletes it on that server. */
async function leave(oldApi: SyncSession, entries: DeviceLogEntry[], me: { id: string; keys: ReturnType<typeof deviceIdentity> }) {
  try {
    const { entries: latest } = await oldApi.log().catch(() => ({ entries }));
    const state = verifyDeviceLog(latest);
    if (!state.members.has(me.id)) return;
    await oldApi.appendLog(appendEntry(state, latest.length, me, { type: 'remove', deviceId: me.id }, Date.now()));
  } catch (e) {
    console.warn('[sync] couldn’t leave the old family', e);
  }
}
