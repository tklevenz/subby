import { describe, expect, it } from 'vitest';
import { planOpen, rawKey, toHex, type OpenState } from './encryption';

const state = (s: Partial<OpenState>): OpenState => ({ cipher: true, hasKey: false, hasPlain: false, hasEncrypted: false, ...s });

describe('planOpen', () => {
  it('uses the plain database without SQLCipher (Expo Go)', () => {
    expect(planOpen(state({ cipher: false, hasPlain: true }))).toEqual({ kind: 'plain' });
  });

  it('creates a key for a fresh install', () => {
    expect(planOpen(state({}))).toEqual({ kind: 'open', newKey: true });
  });

  it('encrypts an existing plain database with a new key', () => {
    expect(planOpen(state({ hasPlain: true }))).toEqual({ kind: 'encrypt', newKey: true });
  });

  it('redoes an interrupted copy with the saved key', () => {
    expect(planOpen(state({ hasPlain: true, hasKey: true, hasEncrypted: true }))).toEqual({ kind: 'encrypt', newKey: false });
  });

  it('opens the encrypted database with its key', () => {
    expect(planOpen(state({ hasKey: true, hasEncrypted: true }))).toEqual({ kind: 'open', newKey: false });
  });

  it('sets an encrypted database aside when its key is gone', () => {
    expect(planOpen(state({ hasEncrypted: true }))).toEqual({ kind: 'setAside' });
  });
});

it('formats a raw 256-bit key', () => {
  const hex = toHex(new Uint8Array(32).fill(0xab));
  expect(hex).toHaveLength(64);
  expect(rawKey(hex)).toBe(`"x'${'ab'.repeat(32)}'"`);
});
