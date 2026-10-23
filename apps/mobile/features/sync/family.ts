import { uuidv7 } from 'uuidv7';
import {
  RECOVERY_SIGNER,
  appendEntry,
  fromBase64,
  newSymmetricKey,
  openSealed,
  pairingCode,
  recoveryIdentity,
  seal,
  toBase64,
  verifyDeviceLog,
} from '@kindred-log/shared/crypto';
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
} from '@kindred-log/shared/sync';
import { db, schema } from '../../db/client';
import { deleteAllPhotos } from '../photos';
import { useChildStore } from '../../store/useChildStore';
import { useLogStore } from '../../store/useLogStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { checkServer, normalizeServerUrl, SyncHttpError, SyncSession } from './api';
import { deviceIdentity, loadFamilyKeys, saveFamilyKeys } from './keystore';
import { pushDeviceName, refreshKeys, refreshMembers, requestSync, saveSync, sessionFor, syncSettings } from './engine';

export { defaultDeviceName } from './engine';

const member = () => {
  const settings = syncSettings();
  if (!settings) throw new Error('Sync is not set up on this phone');
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
  if (!checkClaimMac(invite.secret, claimant)) throw new Error("This request didn't come from the phone that scanned the code");
  return pairingCode(member().me.keys.sign.publicKey, fromBase64(claimant.signKey), invite.secret);
}

/** After the codes matched: signs the new phone into the device log and hands it every family key. */
export async function approveClaim(claimant: NonNullable<InviteResponse['claimant']>) {
  const { settings, api, me } = member();
  const { entries, state } = await refreshMembers(api, settings);
  const keys = { sign: fromBase64(claimant.signKey), box: fromBase64(claimant.boxKey) };
  const entry = appendEntry(state, entries.length, me, { type: 'add', deviceId: claimant.deviceId, keys }, Date.now());
  await api.request('POST', '/v1/families/me/log', { entry });
  const sealed = [...loadFamilyKeys()].map(([epoch, key]) => ({ epoch, sealed: toBase64(seal(keys.box, key)) }));
  await api.request('POST', '/v1/keys/grant', { recipient: claimant.deviceId, keys: sealed });
  await saveSync({ knownDevices: [...(settings.knownDevices ?? []), claimant.deviceId] });
  requestSync(0);
}

/**
 * Removes a phone and starts a new family key that only the remaining phones (and the recovery key) get,
 * so the removed phone can't read anything written from now on.
 */
export async function removeDevice(deviceId: string) {
  const { settings, api, me } = member();
  const { entries, state } = await refreshMembers(api, settings);
  const entry = appendEntry(state, entries.length, me, { type: 'remove', deviceId }, Date.now());
  await api.request('POST', '/v1/families/me/log', { entry });
  const after = verifyDeviceLog([...entries, entry]);

  const { keys, epoch: current } = await refreshKeys(api);
  const epoch = current + 1;
  const key = newSymmetricKey();
  const sealed: Record<string, string> = {};
  for (const [id, m] of after.members) sealed[id] = toBase64(seal(m.boxKey, key));
  if (after.recovery) sealed[RECOVERY_SIGNER] = toBase64(seal(after.recovery.boxKey, key));
  await api.request('POST', '/v1/keys/rotate', { epoch, sealed });
  keys.set(epoch, key);
  saveFamilyKeys(keys);
  // Its name goes too (a tombstone, so the server drops the ciphertext and other phones forget it).
  await api.push([sealRecord(key, epoch, { id: deviceId, kind: 'device', updatedAt: Date.now(), deviceId: me.id, deleted: true }, null)]);

  const names = { ...settings.names };
  delete names[deviceId];
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
  const entry = appendEntry(state, entries.length, me, { type: 'setRecovery', deviceId: RECOVERY_SIGNER, keys }, Date.now());
  await api.request('POST', '/v1/families/me/log', { entry });
  const { keys: familyKeys } = await refreshKeys(api);
  const sealed = [...familyKeys].map(([epoch, key]) => ({ epoch, sealed: toBase64(seal(keys.box, key)) }));
  await api.request('POST', '/v1/keys/grant', { recipient: RECOVERY_SIGNER, keys: sealed });
  await refreshMembers(api, settings);
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
    if (e instanceof SyncHttpError && e.status === 404) throw new Error("These words don't belong to a family on this server");
    throw e;
  }
  const { entries } = await rec.log();
  const state = verifyDeviceLog(entries);
  if (!state.recovery || toBase64(state.recovery.signKey) !== toBase64(recovery.sign.publicKey)) {
    throw new Error("The family's recovery key doesn't match these words");
  }
  const res = await rec.keys();
  const familyKeys = res.keys.map((k) => ({ epoch: k.epoch, key: openSealed(recovery, fromBase64(k.sealed)) }));

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
  if (res.status === 404) throw new Error('This code is not valid');
  if (res.status === 409) throw new Error('This code was already used or has expired. Ask for a new one.');
  if (!res.ok) throw new Error(`The server refused the code (${res.status})`);
  return { qr, deviceId, code: pairingCode(fromBase64(qr.p), sign, secret) };
}

export async function joinStatus(join: Join): Promise<InviteResponse['status']> {
  const res = await fetch(`${join.qr.s}/v1/invites/${join.qr.i}/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ claimKey: toBase64(claimKeyOf(fromBase64(join.qr.k))) }),
  });
  if (!res.ok) throw new Error('Lost the connection to the server');
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
      if (!inviter || toBase64(inviter.signKey) !== join.qr.p) throw new Error("The family's phone list doesn't match the code. Try again.");
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
  if (!state.members.has(deviceId)) throw new Error('This phone was not added to the family');

  const res = await session.request<KeysResponse>('GET', '/v1/keys');
  const identity = deviceIdentity();
  saveFamilyKeys(new Map(res.keys.map((k) => [k.epoch, openSealed(identity, fromBase64(k.sealed))])));

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
  }

  await useSettingsStore.getState().set('sync', {
    server,
    familyId,
    deviceId,
    lastSeq: 0,
    lastSyncedAt: null,
    knownDevices: [...state.members.keys()],
  });
  await pushDeviceName(name);
  requestSync(0);
}
