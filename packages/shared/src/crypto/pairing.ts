import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, utf8ToBytes } from './bytes';

/**
 * The 6-digit code both screens show while pairing. It covers both devices' signing keys and the invite
 * secret, so a server that swapped in its own key would make the codes differ. Order-independent.
 */
export function pairingCode(signKeyA: Uint8Array, signKeyB: Uint8Array, inviteSecret: Uint8Array): string {
  const [first, second] = [signKeyA, signKeyB].sort((a, b) => bytesToHex(a).localeCompare(bytesToHex(b)));
  const digest = sha256(concatBytes(utf8ToBytes('kindred/pairing/v1'), first, second, inviteSecret));
  const n = new DataView(digest.buffer, digest.byteOffset).getUint32(0) % 1_000_000;
  return n.toString().padStart(6, '0');
}
