import { describe, expect, it } from 'vitest';
import { newSymmetricKey } from '../crypto';
import { clientApplies, compareVersions, openRecord, sealRecord, serverAccepts, type RecordMeta } from '../sync';

describe('records', () => {
  const key = newSymmetricKey();
  const keys = new Map([[1, key]]);
  const meta: RecordMeta = { id: 'log-1', kind: 'log', updatedAt: 1000, deviceId: 'dev-a', deleted: false };
  const body = { logType: 'diaper', payload: { type: 'diaper', condition: 'wet' } };

  it('round-trips and hides the content', () => {
    const rec = sealRecord(key, 1, meta, body);
    expect(rec.data).not.toContain('diaper');
    expect(openRecord(keys, rec)).toEqual(body);
  });

  it('tombstones carry no data', () => {
    const rec = sealRecord(key, 1, { ...meta, deleted: true }, body);
    expect(rec.data).toBeNull();
    expect(openRecord(keys, rec)).toBeNull();
  });

  it('binds the data to its metadata', () => {
    const rec = sealRecord(key, 1, meta, body);
    // A server moving data to another record, or replaying it as a newer version, is detected.
    expect(() => openRecord(keys, { ...rec, id: 'log-2' })).toThrow();
    expect(() => openRecord(keys, { ...rec, updatedAt: 2000 })).toThrow();
    expect(() => openRecord(keys, { ...rec, kind: 'child' })).toThrow();
  });

  it('needs the key of its epoch', () => {
    const rec = sealRecord(key, 2, meta, body);
    expect(() => openRecord(keys, rec)).toThrow('epoch 2');
  });
});

describe('merge', () => {
  it('orders by time, then device id', () => {
    expect(compareVersions({ updatedAt: 2, deviceId: 'a' }, { updatedAt: 1, deviceId: 'z' })).toBeGreaterThan(0);
    expect(compareVersions({ updatedAt: 1, deviceId: 'b' }, { updatedAt: 1, deviceId: 'a' })).toBeGreaterThan(0);
    expect(compareVersions({ updatedAt: 1, deviceId: 'a' }, { updatedAt: 1, deviceId: 'a' })).toBe(0);
  });

  it('server keeps only strictly newer versions', () => {
    expect(serverAccepts(null, { updatedAt: 1, deviceId: 'a' })).toBe(true);
    expect(serverAccepts({ updatedAt: 5, deviceId: 'a' }, { updatedAt: 4, deviceId: 'z' })).toBe(false);
    expect(serverAccepts({ updatedAt: 5, deviceId: 'a' }, { updatedAt: 5, deviceId: 'a' })).toBe(false);
  });

  it('client applies pulled records unless its own unpushed edit is newer', () => {
    const incoming = { updatedAt: 10, deviceId: 'other' };
    expect(clientApplies(null, incoming, 'me')).toBe(true);
    expect(clientApplies({ updatedAt: 10, pending: false }, incoming, 'me')).toBe(true);
    expect(clientApplies({ updatedAt: 11, pending: false }, incoming, 'me')).toBe(false);
    expect(clientApplies({ updatedAt: 9, pending: true }, incoming, 'me')).toBe(true);
    expect(clientApplies({ updatedAt: 12, pending: true }, incoming, 'me')).toBe(false);
    // Same millisecond: the same device-id tie-break the server uses.
    expect(clientApplies({ updatedAt: 10, pending: true }, incoming, 'zzz')).toBe(false);
    expect(clientApplies({ updatedAt: 10, pending: true }, incoming, 'aaa')).toBe(true);
  });
});

describe('invite code', () => {
  it('round-trips and rejects junk', async () => {
    const { decodeInviteQr, encodeInviteQr } = await import('../sync');
    const qr = { v: 1 as const, s: 'http://localhost:8787', i: 'id', k: 'secret', d: 'dev', p: 'key' };
    const text = encodeInviteQr(qr);
    expect(text).toMatch(/^kindred:[A-Za-z0-9_-]+$/);
    expect(decodeInviteQr(`  ${text}\n`)).toEqual(qr);
    expect(() => decodeInviteQr('kindred:!!!')).toThrow('damaged');
    expect(() => decodeInviteQr('https://example.com')).toThrow('Not a Kindred');
  });
});
