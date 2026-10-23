import { utf8ToBytes } from '@noble/hashes/utils.js';

export { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = new Map([...ALPHABET].map((c, i) => [c, i]));

/** base64url without padding: the wire encoding for keys, nonces and ciphertext (no Buffer on React Native). */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) out += ALPHABET[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  if (text.length % 4 === 1) throw new Error('Invalid base64url length');
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (const c of text) {
    const v = LOOKUP.get(c);
    if (v === undefined) throw new Error('Invalid base64url character');
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 255;
    }
  }
  return out;
}

/** UTF-8 decode. Hermes (React Native) has TextEncoder but not always TextDecoder, so there's a fallback. */
export function bytesToUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    let cp: number;
    if (b < 0x80) cp = b;
    else if (b >= 0xc2 && b < 0xe0) cp = ((b & 0x1f) << 6) | cont(bytes, i++);
    else if (b >= 0xe0 && b < 0xf0) cp = ((b & 0x0f) << 12) | (cont(bytes, i++) << 6) | cont(bytes, i++);
    else if (b >= 0xf0 && b < 0xf5) cp = ((b & 0x07) << 18) | (cont(bytes, i++) << 12) | (cont(bytes, i++) << 6) | cont(bytes, i++);
    else throw new Error('Invalid UTF-8');
    out += String.fromCodePoint(cp);
  }
  return out;
}

function cont(bytes: Uint8Array, i: number): number {
  const b = bytes[i];
  if (b === undefined || (b & 0xc0) !== 0x80) throw new Error('Invalid UTF-8');
  return b & 0x3f;
}
export const jsonToBytes = (value: unknown) => utf8ToBytes(JSON.stringify(value));
export const bytesToJson = <T>(bytes: Uint8Array): T => JSON.parse(bytesToUtf8(bytes)) as T;

/** Big-endian u64 (safe-integer range), used in nonces and signed messages. */
export function u64(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('u64 out of range');
  // High/low 32-bit halves instead of setBigUint64, which not every JS engine (Hermes) has.
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setUint32(0, Math.floor(n / 2 ** 32));
  view.setUint32(4, n >>> 0);
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
