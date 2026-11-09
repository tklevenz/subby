import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { concatBytes, u64 } from './bytes';
import { TAG_BYTES } from './aead';
import { randomBytes } from './random';

/** Photos are encrypted in chunks so a damaged or truncated upload is detected, not silently shortened. */
export const FILE_CHUNK = 64 * 1024;
const PREFIX_BYTES = 16;
const MAGIC = new Uint8Array([0x6b, 0x6c, 0x66, 0x31]); // "klf1"

// Per-chunk nonce: random prefix (16) || chunk counter (8). The AAD marks the last chunk.
const chunkCipher = (key: Uint8Array, prefix: Uint8Array, i: number, last: boolean) =>
  xchacha20poly1305(key, concatBytes(prefix, u64(i)), new Uint8Array([last ? 1 : 0]));

/** Encrypts a whole file with its own key. Output: "klf1" || prefix || chunk ciphertexts. */
export function encryptFile(key: Uint8Array, data: Uint8Array): Uint8Array {
  const prefix = randomBytes(PREFIX_BYTES);
  const count = Math.max(1, Math.ceil(data.length / FILE_CHUNK));
  const parts = [MAGIC, prefix];
  for (let i = 0; i < count; i++) {
    const chunk = data.subarray(i * FILE_CHUNK, (i + 1) * FILE_CHUNK);
    parts.push(chunkCipher(key, prefix, i, i === count - 1).encrypt(chunk));
  }
  return concatBytes(...parts);
}

/** The size of `encryptFile`'s output for `length` bytes of input. */
export const encryptedFileSize = (length: number) =>
  MAGIC.length + PREFIX_BYTES + length + TAG_BYTES * Math.max(1, Math.ceil(length / FILE_CHUNK));

export function decryptFile(key: Uint8Array, box: Uint8Array): Uint8Array {
  const header = MAGIC.length + PREFIX_BYTES;
  if (box.length < header + TAG_BYTES || !MAGIC.every((b, i) => box[i] === b)) throw new Error('Not an encrypted file');
  const prefix = box.subarray(MAGIC.length, header);
  const body = box.subarray(header);
  const sealedChunk = FILE_CHUNK + TAG_BYTES;
  const count = Math.max(1, Math.ceil(body.length / sealedChunk));
  const parts: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    // Throws if chunks were cut off: the last one present was not encrypted as last.
    parts.push(chunkCipher(key, prefix, i, i === count - 1).decrypt(body.subarray(i * sealedChunk, (i + 1) * sealedChunk)));
  }
  return concatBytes(...parts);
}
