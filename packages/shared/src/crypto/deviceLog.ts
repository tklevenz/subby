import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, fromBase64, toBase64, utf8ToBytes } from './bytes';
import { sign, verify, type IdentityKeys } from './keys';

/** Signer id used by entries the recovery key signs (enrolling a device after every phone was lost). */
export const RECOVERY_SIGNER = 'recovery';

export type DeviceLogType =
  /** First entry: the device that created the family, signed by itself. */
  | 'create'
  | 'add'
  | 'remove'
  /** Sets (or with null keys, clears) the recovery key. Only a device may do this. */
  | 'setRecovery';

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
  /** deviceId of the signer, or `RECOVERY_SIGNER`. */
  signer: string;
  at: number;
  sig: string;
};

export type Member = { signKey: Uint8Array; boxKey: Uint8Array };
export type DeviceLogState = {
  members: Map<string, Member>;
  recovery: Member | null;
  /** Hash of the last entry: the `prev` of the next one. */
  head: string;
};

type Unsigned = Omit<DeviceLogEntry, 'sig'>;

// Fixed key order, so every platform signs and hashes the same bytes.
const canonical = (e: Unsigned) =>
  utf8ToBytes(
    JSON.stringify([
      'kindred/devicelog/v1', e.index, e.prev, e.type, e.deviceId, e.signKey, e.boxKey, e.signer, e.at,
    ]),
  );

export const entryHash = (e: DeviceLogEntry) => bytesToHex(sha256(concatBytes(canonical(e), fromBase64(e.sig))));

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

    switch (e.type) {
      case 'create':
      case 'add':
        if (members.has(e.deviceId) || removed.has(e.deviceId)) fail('device id already used');
        members.set(e.deviceId, keysOf(e));
        break;
      case 'remove':
        if (!members.delete(e.deviceId)) fail('device is not a member');
        removed.add(e.deviceId);
        break;
      case 'setRecovery':
        if (e.deviceId !== RECOVERY_SIGNER) fail('setRecovery must target the recovery key');
        recovery = e.signKey || e.boxKey ? keysOf(e) : null;
        break;
      default:
        fail('unknown entry type');
    }
    head = entryHash(e);
  });

  if (!entries.length) throw new Error('Device log is empty');
  return { members, recovery, head };
}

/** Builds the next entry on top of a verified state. */
export function appendEntry(
  state: DeviceLogState | null,
  entriesSoFar: number,
  signer: { id: string; keys: IdentityKeys },
  change: { type: DeviceLogType; deviceId: string; keys?: { sign: Uint8Array; box: Uint8Array } | null },
  at: number,
): DeviceLogEntry {
  return signEntry(signer.keys, {
    index: entriesSoFar,
    prev: state?.head ?? '',
    type: change.type,
    deviceId: change.deviceId,
    signKey: change.keys ? toBase64(change.keys.sign) : null,
    boxKey: change.keys ? toBase64(change.keys.box) : null,
    signer: signer.id,
    at,
  });
}
