import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { concatBytes } from './bytes';
import { randomBytes } from './random';

export const KEY_BYTES = 32;
export const NONCE_BYTES = 24;
export const TAG_BYTES = 16;

/** XChaCha20-Poly1305 with a random 24-byte nonce (safe to pick at random). Output: nonce || ciphertext+tag. */
export function encrypt(key: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array {
  const nonce = randomBytes(NONCE_BYTES);
  return concatBytes(nonce, xchacha20poly1305(key, nonce, aad).encrypt(plaintext));
}

/** Throws if the key, the additional data or any byte of the box is wrong. */
export function decrypt(key: Uint8Array, box: Uint8Array, aad?: Uint8Array): Uint8Array {
  if (box.length < NONCE_BYTES + TAG_BYTES) throw new Error('Ciphertext too short');
  return xchacha20poly1305(key, box.subarray(0, NONCE_BYTES), aad).decrypt(box.subarray(NONCE_BYTES));
}

export const newSymmetricKey = () => randomBytes(KEY_BYTES);
