import { describe, expect, it } from 'vitest';
import { identityFromSeed, setSignatureVerifier, sign, verify } from '@subby/shared/crypto';
import { nativeVerify } from '../src/common/ed25519';

describe('native Ed25519 verifier', () => {
  const keys = identityFromSeed(new Uint8Array(32).fill(7));
  const message = new TextEncoder().encode('subby/auth/v1 test');
  const signature = sign(keys, message);
  const other = identityFromSeed(new Uint8Array(32).fill(8));

  it('accepts what the shared (noble) signer signs, and nothing else', () => {
    expect(nativeVerify(keys.sign.publicKey, message, signature)).toBe(true);
    const tampered = signature.slice();
    tampered[10]! ^= 1;
    expect(nativeVerify(keys.sign.publicKey, message, tampered)).toBe(false);
    expect(nativeVerify(other.sign.publicKey, message, signature)).toBe(false);
    expect(nativeVerify(keys.sign.publicKey, new TextEncoder().encode('other'), signature)).toBe(false);
  });

  it('refuses malformed input through the shared verify instead of throwing', () => {
    setSignatureVerifier(nativeVerify);
    expect(verify(keys.sign.publicKey, message, signature)).toBe(true);
    expect(verify(keys.sign.publicKey.slice(0, 31), message, signature)).toBe(false);
    expect(verify(keys.sign.publicKey, message, signature.slice(0, 63))).toBe(false);
    expect(verify(new Uint8Array(32).fill(0xff), message, signature)).toBe(false);
  });
});
