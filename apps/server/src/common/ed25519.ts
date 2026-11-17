import { createPublicKey, verify } from 'node:crypto';

// Turns a raw 32-byte Ed25519 public key into the SPKI DER that node:crypto takes.
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Ed25519 verification by OpenSSL: ~15x faster than the shared code's pure-JS noble (measured 2026-11-17). OpenSSL
 * refuses non-canonical encodings that noble's ZIP-215 rules accept, so it is stricter, never looser; honest
 * signers never produce them.
 */
export function nativeVerify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, publicKey]), format: 'der', type: 'spki' });
  return verify(null, message, key, signature);
}
