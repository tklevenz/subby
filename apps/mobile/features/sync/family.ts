import { t } from '@subby/shared/i18n';
import { uuidv7 } from 'uuidv7';
import {
  RECOVERY_SIGNER,
  appendEntry,
  fromBase64,
  openFamilyKey,
  pairingCode,
  recoveryIdentity,
  seal,
  toBase64,
  verifyDeviceLog,
} from '@subby/shared/crypto';
import {
  checkClaimMac,
  claimHashOf,
  claimKeyOf,
  claimMac,
  decodeInviteQr,
  encodeInviteQr,
  newInviteSecret,
  sealRecord,
  type InviteQr,
  type InviteResponse,
  type KeysResponse,
} from '@subby/shared/sync';
import { db, schema } from '../../db/client';
import { deleteAllPhotos } from '../photos';
import { forgetPhotoUploads } from './photos';
import { useChildStore } from '../../store/useChildStore';
import { useLogStore } from '../../store/useLogStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { checkServer, normalizeServerUrl, SyncHttpError, SyncSession } from './api';
import { deviceIdentity, loadFamilyKeys, saveFamilyKeys } from './keystore';
import { pushDeviceName, refreshKeys, refreshMembers, requestSync, rotateKeys, saveSync, sessionFor, syncSettings } from './engine';

export { defaultDeviceName } from './engine';

const member = () => {
  const settings = syncSettings();
  if (!settings) throw new Error(t('sync.error.notSetUp'));
  return { settings, api: sessionFor(settings), me: { id: settings.deviceId, keys: deviceIdentity() } };
};

// --- inviting (the phone already in the family) ----------------------------------------------------------

export type Invite = { inviteId: string; secret: Uint8Array; code: string; expiresAt: number };

/** Creates a one-time invite; `code` is what the QR code shows (valid for 10 minutes). */
export async function createInvite(): Promise<Invite> {
  const { settings, api, me } = member();
  const secret = newInviteSecret();
  const inviteId = uuidv7();
  const { expiresAt } = await api.request<{ expiresAt: number }>('POST', '/v1/invites', {
    inviteId,
    claimHash: claimHashOf(claimKeyOf(secret)),
  });
  const qr: InviteQr = { v: 1, s: settings.server, i: inviteId, k: toBase64(secret), d: me.id, p: toBase64(me.keys.sign.publicKey) };
  return { inviteId, secret, code: encodeInviteQr(qr), expiresAt };
}

export const inviteStatus = (inviteId: string) => member().api.request<InviteResponse>('GET', `/v1/invites/${inviteId}`);

/**
 * The 6-digit code for a claimed invite. Throws if the claim was altered on the way (its MAC is keyed by
 * the QR secret, which the server never had).
 */
export function claimCode(invite: Invite, claimant: NonNullable<InviteResponse['claimant']>) {
  if (!checkClaimMac(invite.secret, claimant)) throw new Error(t('sync.error.claimAltered'));
  return pairingCode(member().me.keys.sign.publicKey, fromBase64(claimant.signKey), invite.secret);
}

/**
 * After the codes matched: signs the new phone into the device log and hands it every family key. Safe to retry:
 * a phone already added only gets its keys (and any phone's next sync grants keys still missing).
 */
export async function approveClaim(claimant: NonNullable<InviteResponse['claimant']>) {
  const { settings, api, me } = member();
  const { entries, state } = await refreshMembers(api, settings);
  const keys = { sign: fromBase64(claimant.signKey), box: fromBase64(claimant.boxKey) };
  if (!state.members.has(claimant.deviceId)) {
    const entry = appendEntry(state, entries.length, me, { type: 'add', deviceId: claimant.deviceId, keys }, Date.now());
    await api.request('POST', '/v1/families/me/log', { entry });
  }
  const sealed = [...loadFamilyKeys()].map(([epoch, key]) => ({ epoch, sealed: toBase64(seal(keys.box, key)) }));
  await api.request('POST', '/v1/keys/grant', { recipient: claimant.deviceId, keys: sealed });
  await saveSync({ knownDevices: [...(settings.knownDevices ?? []), claimant.deviceId] });
  requestSync(0);
}

/**
 * Removes a phone and starts a new family key that only the remaining phones (and the recovery key) get,
 * so the removed phone can't read anything written from now on.
 */
export const removeDevice = (deviceId: string) => removeDevices([deviceId]);

/**
 * Removes phones from the family: a signed `remove` for each, then one new family key for the rest (instead of a
 * rotation per phone). Used for a single phone on the Sync screen, and for the lost phones after a recovery.
 */
export async function removeDevices(deviceIds: string[]) {
  if (!deviceIds.length) return;
  const { settings, api, me } = member();
  const { entries, state } = await refreshMembers(api, settings);
  const { keys } = await refreshKeys(api, state);
  const log = [...entries];
  let after = state;
  for (const deviceId of deviceIds) {
    if (deviceId === me.id || !after.members.has(deviceId)) continue;
    const entry = appendEntry(after, log.length, me, { type: 'remove', deviceId }, Date.now());
    await api.request('POST', '/v1/families/me/log', { entry });
    log.push(entry);
    after = verifyDeviceLog(log);
  }
  if (after === state) return;
  // If this stops here (no connection, app closed), the log says a rotation is owed and the next sync does it.
  const { epoch, key } = await rotateKeys(api, settings, log, after, keys);
  // Their names go too (tombstones, so the server drops the ciphertext and other phones forget them). Best effort:
  // the removal is done by now, and a phone that may not push (hosted, read-only) gets a 402 here.
  await api
    .push(deviceIds.map((deviceId) => sealRecord(key, epoch, { id: deviceId, kind: 'device', updatedAt: Date.now(), deviceId: me.id, deleted: true }, null)))
    .catch((e) => console.warn("[sync] couldn't remove the removed phones' names", e));

  const names = { ...settings.names };
  for (const deviceId of deviceIds) delete names[deviceId];
  await saveSync({ names, knownDevices: [...after.members.keys()] });
  await refreshMembers(api, { ...settings, knownDevices: [...after.members.keys()] });
  requestSync(0);
}

// --- recovery key ----------------------------------------------------------------------------------------

/**
 * Makes `words` the family's recovery key (replacing any earlier one, whose words stop working) and seals
 * every family key to it. Call only after the person has written the words down.
 */
export async function setRecoveryKey(words: string) {
  const { settings, api, me } = member();
  const recovery = recoveryIdentity(words);
  const { entries, state } = await refreshMembers(api, settings);
  const keys = { sign: recovery.sign.publicKey, box: recovery.box.publicKey };
  // A retry with the same words after a failed grant doesn't log them twice.
  const alreadySet = state.recovery && toBase64(state.recovery.signKey) === toBase64(keys.sign);
  if (!alreadySet) {
    const entry = appendEntry(state, entries.length, me, { type: 'setRecovery', deviceId: RECOVERY_SIGNER, keys }, Date.now());
    await api.request('POST', '/v1/families/me/log', { entry });
  }
  const { keys: familyKeys } = await refreshKeys(api);
  const sealed = [...familyKeys].map(([epoch, key]) => ({ epoch, sealed: toBase64(seal(keys.box, key)) }));
  await api.request('POST', '/v1/keys/grant', { recipient: RECOVERY_SIGNER, keys: sealed });
  await refreshMembers(api, settings);
  // Replacing earlier words owes a new epoch (the old words must not read on); the sync run starts it.
  requestSync(0);
}

/**
 * A phone with only the recovery words (every other phone lost): logs in as the recovery key, adds this
 * phone to the family, hands it the family keys, then joins like a scanned invite.
 */
export async function recoverFamily(serverInput: string, words: string, local: 'merge' | 'replace', name: string) {
  const server = normalizeServerUrl(serverInput);
  await checkServer(server);
  const recovery = recoveryIdentity(words);
  const rec = new SyncSession(server, RECOVERY_SIGNER, recovery, true);
  try {
    await rec.login();
  } catch (e) {
    if (e instanceof SyncHttpError && e.status === 404) throw new Error(t('sync.error.recoveryNoFamily'));
    throw e;
  }
  const { entries } = await rec.log();
  const state = verifyDeviceLog(entries);
  if (!state.recovery || toBase64(state.recovery.signKey) !== toBase64(recovery.sign.publicKey)) {
    throw new Error(t('sync.error.recoveryMismatch'));
  }
  const res = await rec.keys();
  const familyKeys = res.keys.map((k) => ({ epoch: k.epoch, key: openFamilyKey(recovery, state, k.epoch, fromBase64(k.sealed)) }));

  const identity = deviceIdentity();
  const deviceId = uuidv7();
  const keys = { sign: identity.sign.publicKey, box: identity.box.publicKey };
  const entry = appendEntry(state, entries.length, { id: RECOVERY_SIGNER, keys: recovery }, { type: 'add', deviceId, keys }, Date.now());
  await rec.request('POST', '/v1/families/me/log', { entry });
  await rec.request('POST', '/v1/keys/grant', {
    recipient: deviceId,
    keys: familyKeys.map((k) => ({ epoch: k.epoch, sealed: toBase64(seal(keys.box, k.key)) })),
  });
  await completeJoin(server, deviceId, () => {}, local, name);
}

// --- joining (the new phone) -----------------------------------------------------------------------------

export type Join = { qr: InviteQr; deviceId: string; code: string };

/** Scanned or pasted code → claims the invite with this phone's keys; returns the code to compare. */
export async function claimInvite(text: string): Promise<Join> {
  const qr = decodeInviteQr(text);
  await checkServer(qr.s);
  const identity = deviceIdentity();
  const deviceId = uuidv7();
  const secret = fromBase64(qr.k);
  const sign = identity.sign.publicKey;
  const box = identity.box.publicKey;
  const res = await fetch(`${qr.s}/v1/invites/${qr.i}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      claimKey: toBase64(claimKeyOf(secret)),
      deviceId,
      signKey: toBase64(sign),
      boxKey: toBase64(box),
      mac: claimMac(secret, deviceId, sign, box),
    }),
  });
  if (res.status === 404) throw new Error(t('sync.error.codeInvalid'));
  if (res.status === 409) throw new Error(t('sync.error.codeUsed'));
  if (!res.ok) throw new Error(t('sync.error.codeRefused', { status: String(res.status) }));
  return { qr, deviceId, code: pairingCode(fromBase64(qr.p), sign, secret) };
}

export async function joinStatus(join: Join): Promise<InviteResponse['status']> {
  const res = await fetch(`${join.qr.s}/v1/invites/${join.qr.i}/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ claimKey: toBase64(claimKeyOf(fromBase64(join.qr.k))) }),
  });
  if (!res.ok) throw new Error(t('sync.error.connectionLost'));
  return ((await res.json()) as InviteResponse).status;
}

/** Whether this phone has its own children or entries (decides whether to ask what to do with them). */
export async function hasLocalData() {
  const children = await db.select({ id: schema.childrenTable.id }).from(schema.childrenTable).limit(1);
  const logs = await db.select({ id: schema.logsTable.id }).from(schema.logsTable).limit(1);
  return children.length > 0 || logs.length > 0;
}

/**
 * Once approved: checks the device log (the inviting phone from the QR code must be in it, and so must
 * this one), takes the family keys, then either adds this phone's data to the family or replaces it.
 */
export function finishJoin(join: Join, local: 'merge' | 'replace', name: string) {
  return completeJoin(
    join.qr.s,
    join.deviceId,
    (state) => {
      const inviter = state.members.get(join.qr.d);
      if (!inviter || toBase64(inviter.signKey) !== join.qr.p) throw new Error(t('sync.error.logMismatch'));
    },
    local,
    name,
  );
}

/** Logs in as the newly added phone, checks the device log, takes the keys and sets up local data. */
async function completeJoin(
  server: string,
  deviceId: string,
  check: (state: ReturnType<typeof verifyDeviceLog>) => void,
  local: 'merge' | 'replace',
  name: string,
) {
  const session = new SyncSession(server, deviceId, deviceIdentity());
  const { familyId } = await session.login();
  const { entries } = await session.log();
  const state = verifyDeviceLog(entries);
  check(state);
  if (!state.members.has(deviceId)) throw new Error(t('sync.error.notAdded'));

  const identity = deviceIdentity();
  // Each key must match the family's commitment in the log; the server can't slip in its own. If the inviting
  // phone's grant failed, its next sync grants them, so wait a little before giving up.
  let keys = new Map<number, Uint8Array>();
  for (let attempt = 0; attempt < 10 && !keys.has(state.epoch); attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 2000));
    const res = await session.request<KeysResponse>('GET', '/v1/keys');
    keys = new Map(res.keys.map((k) => [k.epoch, openFamilyKey(identity, state, k.epoch, fromBase64(k.sealed))]));
  }
  if (!keys.has(state.epoch)) throw new Error(t('sync.error.noFamilyKey'));
  saveFamilyKeys(keys);

  if (local === 'replace') {
    db.transaction((tx) => {
      tx.delete(schema.logsTable).run();
      tx.delete(schema.remindersTable).run();
      tx.delete(schema.childrenTable).run();
    });
    deleteAllPhotos();
    await useSettingsStore.getState().set('activeChildId', null);
    useLogStore.setState({ logs: [], activeChildId: null });
    await useChildStore.getState().hydrate();
  } else {
    await db.update(schema.childrenTable).set({ syncStatus: 'pending' });
    await db.update(schema.logsTable).set({ syncStatus: 'pending' });
    // This phone's photos belong to its old family (if any); they upload to this one.
    await forgetPhotoUploads();
  }

  await useSettingsStore.getState().set('sync', {
    server,
    familyId,
    deviceId,
    lastSeq: 0,
    lastSyncedAt: null,
    since: Date.now(),
    knownDevices: [...state.members.keys()],
    photosFamily: familyId,
    logSeen: { length: entries.length, head: state.head },
  });
  await pushDeviceName(name);
  requestSync(0);
}
