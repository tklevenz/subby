import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, equalBytes, fromBase64, toBase64, u64, utf8ToBytes } from './bytes';
import { openSealed, sign, verify, type IdentityKeys } from './keys';

/** Signer id used by entries the recovery key signs (enrolling a device after every phone was lost). */
export const RECOVERY_SIGNER = 'recovery';

export type DeviceLogType =
  /** First entry: the device that created the family, signed by itself. */
  | 'create'
  | 'add'
  | 'remove'
  /** Sets (or with null keys, clears) the recovery key. Only a device may do this. */
  | 'setRecovery'
  /** Starts the next family key epoch (after a removal). Only a device may do this. */
  | 'epoch';

export type DeviceLogEntry = {
  index: number;
  /** sha256 (hex) of the previous entry; '' for the first. */
  prev: string;
  type: DeviceLogType;
  /** The device added or removed (UUID). `RECOVERY_SIGNER` for setRecovery. */
  deviceId: string;
  /** base64url public keys, for create, add and setRecovery. */
  signKey: string | null;
  boxKey: string | null;
  /**
   * For `create` (always 1) and `epoch`: the family key epoch this entry starts, and the key's commitment
   * (`epochKeyHash`). A phone accepts a family key only if it matches, so the server can't hand out its own.
   */
  epoch: number | null;
  keyHash: string | null;
  /** deviceId of the signer, or `RECOVERY_SIGNER`. */
  signer: string;
  at: number;
  sig: string;
};

export type Member = { signKey: Uint8Array; boxKey: Uint8Array };
export type DeviceLogState = {
  members: Map<string, Member>;
  recovery: Member | null;
  /** The current key epoch (the latest one the log started) and every epoch's key commitment. */
  epoch: number;
  keyHashes: Map<number, string>;
  /**
   * A new epoch is owed: a device was removed, or the recovery key was replaced or cleared, since the last one.
   * Whoever holds the old key (the removed phone, the old words) must not read what comes next.
   */
  rotationDue: boolean;
  /** Hash of the last entry: the `prev` of the next one. */
  head: string;
};

type Unsigned = Omit<DeviceLogEntry, 'sig'>;

// Fixed key order, so every platform signs and hashes the same bytes.
const canonical = (e: Unsigned) =>
  utf8ToBytes(
    JSON.stringify([
      'kindred/devicelog/v2', e.index, e.prev, e.type, e.deviceId, e.signKey, e.boxKey, e.epoch, e.keyHash, e.signer, e.at,
    ]),
  );

export const entryHash = (e: DeviceLogEntry) => bytesToHex(sha256(concatBytes(canonical(e), fromBase64(e.sig))));

/** Commitment to a family key, published in the signed log. Reveals nothing about the 256-bit random key. */
export const epochKeyHash = (epoch: number, key: Uint8Array) =>
  toBase64(sha256(concatBytes(utf8ToBytes('kindred/epoch/v1'), u64(epoch), key)));

/**
 * Opens a family key sealed to this phone and checks it against the log's commitment for that epoch.
 * Sealed boxes are anonymous (anyone, the server too, can seal to a public key), so this check is what makes
 * a key trustworthy.
 */
export function openFamilyKey(identity: IdentityKeys, state: DeviceLogState, epoch: number, sealed: Uint8Array): Uint8Array {
  const expected = state.keyHashes.get(epoch);
  if (!expected) throw new Error(`The family's phone list has no key for epoch ${epoch}`);
  const key = openSealed(identity, sealed);
  if (!equalBytes(fromBase64(epochKeyHash(epoch, key)), fromBase64(expected))) throw new Error(`The family key for epoch ${epoch} is not the one the family made`);
  return key;
}

/** How much of the log a phone has already verified: its length and the hash of its last entry. */
export type LogSeen = { length: number; head: string };

/**
 * Throws if the log doesn't continue the one seen before. Each entry is signed, but a server could still serve
 * an older prefix (hiding a removal or a newer epoch); remembering how far the log went catches that.
 */
export function assertLogContinues(entries: DeviceLogEntry[], seen: LogSeen | null | undefined) {
  if (!seen) return;
  if (entries.length < seen.length || entryHash(entries[seen.length - 1]) !== seen.head) {
    throw new Error("The family's phone list is older than the one this phone already saw");
  }
}
export function signEntry(signerKeys: IdentityKeys, entry: Unsigned): DeviceLogEntry {
  return { ...entry, sig: toBase64(sign(signerKeys, canonical(entry))) };
}

const keysOf = (e: DeviceLogEntry): Member => {
  if (!e.signKey || !e.boxKey) throw new Error(`Device log entry ${e.index} is missing keys`);
  return { signKey: fromBase64(e.signKey), boxKey: fromBase64(e.boxKey) };
};

/**
 * Replays the log and returns the current members. Throws on any broken link, bad signature or rule
 * violation, so a server can't insert, drop or reorder entries without every client noticing.
 */
export function verifyDeviceLog(entries: DeviceLogEntry[]): DeviceLogState {
  const members = new Map<string, Member>();
  const removed = new Set<string>();
  let recovery: Member | null = null;
  let epoch = 0;
  const keyHashes = new Map<number, string>();
  let rotationDue = false;
  let head = '';

  entries.forEach((e, i) => {
    const fail = (why: string) => {
      throw new Error(`Device log entry ${i}: ${why}`);
    };
    if (e.index !== i) fail('wrong index');
    if (e.prev !== head) fail('broken chain');

    let signerKey: Uint8Array | undefined;
    if (i === 0) {
      if (e.type !== 'create' || e.signer !== e.deviceId) fail('must start with the creating device');
      signerKey = keysOf(e).signKey;
    } else if (e.type === 'create') {
      fail('only the first entry can create');
    } else if (e.signer === RECOVERY_SIGNER) {
      if (e.type !== 'add') fail('the recovery key can only add devices');
      signerKey = recovery?.signKey ?? fail('no recovery key is set');
    } else {
      signerKey = members.get(e.signer)?.signKey ?? fail('signer is not a member');
    }
    if (!verify(signerKey!, canonical(e), fromBase64(e.sig))) fail('bad signature');

    const startsEpoch = e.type === 'create' || e.type === 'epoch';
    if (startsEpoch) {
      if (e.epoch !== epoch + 1) fail(`must start epoch ${epoch + 1}`);
      if (!e.keyHash || fromBase64(e.keyHash).length !== 32) fail('missing key commitment');
      epoch = e.epoch!;
      keyHashes.set(epoch, e.keyHash!);
      rotationDue = false;
    } else if (e.epoch !== null || e.keyHash !== null) {
      fail('only create and epoch entries carry a key');
    }

    switch (e.type) {
      case 'epoch':
        if (e.deviceId !== e.signer || e.signKey || e.boxKey) fail('an epoch is started by the signing device');
        break;
      case 'create':
      case 'add':
        if (members.has(e.deviceId) || removed.has(e.deviceId)) fail('device id already used');
        members.set(e.deviceId, keysOf(e));
        break;
      case 'remove':
        if (!members.delete(e.deviceId)) fail('device is not a member');
        removed.add(e.deviceId);
        rotationDue = true;
        break;
      case 'setRecovery':
        if (e.deviceId !== RECOVERY_SIGNER) fail('setRecovery must target the recovery key');
        if (recovery) rotationDue = true;
        recovery = e.signKey || e.boxKey ? keysOf(e) : null;
        break;
      default:
        fail('unknown entry type');
    }
    head = entryHash(e);
  });

  if (!entries.length) throw new Error('Device log is empty');
  return { members, recovery, epoch, keyHashes, rotationDue, head };
}

/** Builds the next entry on top of a verified state. */
export function appendEntry(
  state: DeviceLogState | null,
  entriesSoFar: number,
  signer: { id: string; keys: IdentityKeys },
  change: {
    type: DeviceLogType;
    deviceId: string;
    keys?: { sign: Uint8Array; box: Uint8Array } | null;
    /** For create and epoch: the new family key (only its commitment goes into the log). */
    familyKey?: { epoch: number; key: Uint8Array };
  },
  at: number,
): DeviceLogEntry {
  return signEntry(signer.keys, {
    index: entriesSoFar,
    prev: state?.head ?? '',
    type: change.type,
    deviceId: change.deviceId,
    signKey: change.keys ? toBase64(change.keys.sign) : null,
    boxKey: change.keys ? toBase64(change.keys.box) : null,
    epoch: change.familyKey?.epoch ?? null,
    keyHash: change.familyKey ? epochKeyHash(change.familyKey.epoch, change.familyKey.key) : null,
    signer: signer.id,
    at,
  });
}
