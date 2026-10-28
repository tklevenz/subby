import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToJson, concatBytes, equalBytes, fromBase64, jsonToBytes, toBase64, utf8ToBytes } from '../crypto/bytes';
import { randomBytes } from '../crypto/random';
import { AUTH_CONTEXT } from './protocol';

/**
 * Pairing. The QR code carries everything the new device needs and one secret the server never sees:
 * - `claimKey` (derived) unlocks the claim on the server, which stores only its hash;
 * - `macKey` (derived) lets the inviting device check the keys the new device submitted;
 * - the secret itself feeds the 6-digit pairing code.
 */
export type InviteQr = {
  v: 1;
  /** Server base URL. */
  s: string;
  /** Invite id. */
  i: string;
  /** One-time secret (base64url). */
  k: string;
  /** Inviting device id and signing key, so the new device knows who it pairs with without trusting the server. */
  d: string;
  p: string;
};

const derive = (secret: Uint8Array, info: string) => hkdf(sha256, secret, undefined, utf8ToBytes(info), 32);

export const newInviteSecret = () => randomBytes(32);
export const claimKeyOf = (secret: Uint8Array) => derive(secret, 'kindred/invite/claim/v1');
export const claimHashOf = (claimKey: Uint8Array) => toBase64(sha256(claimKey));

const macInput = (deviceId: string, signKey: Uint8Array, boxKey: Uint8Array) =>
  concatBytes(utf8ToBytes(`kindred/invite/mac/v1:${deviceId}:`), signKey, boxKey);

export const claimMac = (secret: Uint8Array, deviceId: string, signKey: Uint8Array, boxKey: Uint8Array) =>
  toBase64(hmac(sha256, derive(secret, 'kindred/invite/mac/v1'), macInput(deviceId, signKey, boxKey)));

export function checkClaimMac(secret: Uint8Array, claimant: { deviceId: string; signKey: string; boxKey: string; mac: string }) {
  const expected = fromBase64(claimMac(secret, claimant.deviceId, fromBase64(claimant.signKey), fromBase64(claimant.boxKey)));
  return equalBytes(expected, fromBase64(claimant.mac));
}

/** `kindred:` + base64url(JSON): URL-safe, so the same text works in a QR code or pasted by hand. */
export const encodeInviteQr = (qr: InviteQr) => `kindred:${toBase64(jsonToBytes(qr))}`;

export function decodeInviteQr(input: string): InviteQr {
  const text = input.trim();
  if (!text.startsWith('kindred:')) throw new Error('Not a Subby code');
  let qr: InviteQr;
  try {
    qr = bytesToJson<InviteQr>(fromBase64(text.slice('kindred:'.length)));
  } catch {
    throw new Error('This code is damaged');
  }
  if (qr.v !== 1 || !qr.s || !qr.i || !qr.k || !qr.d || !qr.p) throw new Error('Unsupported or damaged code');
  return qr;
}

/** What a device signs to log in: the server's challenge, domain-separated. */
export const authMessage = (challenge: string) => utf8ToBytes(`${AUTH_CONTEXT}:${challenge}`);
