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

export const bytesToUtf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
export const jsonToBytes = (value: unknown) => utf8ToBytes(JSON.stringify(value));
export const bytesToJson = <T>(bytes: Uint8Array): T => JSON.parse(bytesToUtf8(bytes)) as T;

/** Big-endian u64 (safe-integer range), used in nonces and signed messages. */
export function u64(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('u64 out of range');
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n));
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
