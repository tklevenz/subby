import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from './bytes';
import { decrypt, encrypt } from './aead';
import { randomBytes } from './random';

export type KeyPair = { secretKey: Uint8Array; publicKey: Uint8Array };
/** A device (or the recovery key) has a signing pair for auth and the device log, and a box pair to receive keys. */
export type IdentityKeys = { sign: KeyPair; box: KeyPair };

/** Both pairs from one 32-byte seed (domain-separated), so the recovery words can rebuild them. */
export function identityFromSeed(seed: Uint8Array): IdentityKeys {
  const derive = (info: string) => hkdf(sha256, seed, undefined, utf8ToBytes(info), 32);
  return {
    sign: ed25519.keygen(derive('kindred/identity/sign/v1')),
    box: x25519.keygen(derive('kindred/identity/box/v1')),
  };
}

export const newIdentity = () => identityFromSeed(randomBytes(32));

export const sign = (keys: IdentityKeys, message: Uint8Array) => ed25519.sign(message, keys.sign.secretKey);

export function verify(signPublicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, signPublicKey);
  } catch {
    return false;
  }
}

const sealKey = (shared: Uint8Array, ephemeral: Uint8Array, recipient: Uint8Array) =>
  hkdf(sha256, shared, concatBytes(ephemeral, recipient), utf8ToBytes('kindred/seal/v1'), 32);

/**
 * Anonymous sealed box: only the holder of `recipientBoxPublicKey`'s secret can open it. Used to hand the
 * family key to a device or to the recovery key. Output: ephemeral public key (32) || nonce || ciphertext.
 */
export function seal(recipientBoxPublicKey: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const eph = x25519.keygen(randomBytes(32));
  const shared = x25519.getSharedSecret(eph.secretKey, recipientBoxPublicKey);
  return concatBytes(eph.publicKey, encrypt(sealKey(shared, eph.publicKey, recipientBoxPublicKey), plaintext));
}

export function openSealed(keys: IdentityKeys, box: Uint8Array): Uint8Array {
  const eph = box.subarray(0, 32);
  const shared = x25519.getSharedSecret(keys.box.secretKey, eph);
  return decrypt(sealKey(shared, eph, keys.box.publicKey), box.subarray(32));
}
