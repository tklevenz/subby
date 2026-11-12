import { describe, expect, it } from 'vitest';
import { fromBase64, newSymmetricKey } from '../crypto';
import { MAX_PUSH, UnsealedRecordError, clientApplies, compareVersions, openRecord, pageContinues, pushChunks, sealRecord, serverAccepts, serverWentBack, settlePush, type RecordMeta } from '../sync';

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

  it('tombstones keep no content but are sealed', () => {
    const rec = sealRecord(key, 1, { ...meta, deleted: true }, body);
    expect(openRecord(keys, rec)).toBeNull();
    // Only an empty body: nothing of the deleted entry stays on the server.
    expect(fromBase64(rec.data!).length).toBeLessThan(64);
    // A server can't delete on its own: a tombstone without data, or turning a live record into one, fails.
    expect(() => openRecord(keys, { ...rec, data: null })).toThrow(UnsealedRecordError);
    expect(() => openRecord(keys, { ...sealRecord(key, 1, meta, body), deleted: true })).toThrow();
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

describe('settling a push', () => {
  const mine = [
    { id: 'a', updatedAt: 100, deviceId: 'me' },
    { id: 'b', updatedAt: 190, deviceId: 'me' },
    { id: 'c', updatedAt: 300, deviceId: 'me' },
  ];
  const winner = (id: string, updatedAt: number, epoch = 2) => ({ id, updatedAt, deviceId: 'other', seq: 5, epoch });

  it('settles accepted rows and stale ones a returned version beats, of any usable epoch', () => {
    // b lost to a version of the previous epoch (another phone's, before a rotation): it still replaces b.
    const res = { accepted: ['a'], stale: ['b'], newer: [winner('b', 200, 1)] };
    expect(settlePush(mine, res, () => true)).toEqual({ settled: ['a', 'b'], held: [], newer: [winner('b', 200, 1)] });
  });

  it("keeps a stale row pending when the server doesn't show what beats it", () => {
    // Nothing returned, an older version, a version of an epoch it can't use, or one for a row it didn't push.
    expect(settlePush(mine, { accepted: [], stale: ['a', 'b', 'c'], newer: [] }, () => true).held).toEqual(['a', 'b', 'c']);
    expect(settlePush(mine, { accepted: [], stale: ['c'], newer: [winner('c', 250)] }, () => true)).toEqual({ settled: [], held: ['c'], newer: [] });
    expect(settlePush(mine, { accepted: [], stale: ['b'], newer: [winner('b', 200, 1)] }, (r) => r.epoch === 2).held).toEqual(['b']);
    expect(settlePush(mine, { accepted: ['x'], stale: ['y'], newer: [winner('y', 999)] }, () => true)).toEqual({ settled: [], held: [], newer: [] });
  });

  it('settles a row the server already has in exactly this version (an answer that got lost)', () => {
    const pushed = [{ id: 'a', updatedAt: 100, deviceId: 'me' }];
    const echo = { id: 'a', updatedAt: 100, deviceId: 'me', seq: 5, epoch: 1 };
    expect(settlePush(pushed, { accepted: [], stale: ['a'], newer: [echo] }, () => true)).toEqual({ settled: ['a'], held: [], newer: [] });
    // Still only if it opens.
    expect(settlePush(pushed, { accepted: [], stale: ['a'], newer: [echo] }, () => false).held).toEqual(['a']);
  });

  it('only takes pull pages that move forward', () => {
    const at = (...seqs: number[]) => seqs.map((seq) => ({ seq }));
    expect(pageContinues(10, { seq: 12, more: true, records: at(11, 12) })).toBe(true);
    expect(pageContinues(10, { seq: 12, more: false, records: at(12) })).toBe(true);
    expect(pageContinues(10, { seq: 10, more: false, records: [] })).toBe(true);
    expect(pageContinues(10, { seq: 10, more: true, records: [] })).toBe(false);
    expect(pageContinues(10, { seq: 9, more: false, records: [] })).toBe(false);
    // More to come, but nothing (or not up to the claimed seq) in this page: a server stringing the phone along.
    expect(pageContinues(10, { seq: 11, more: true, records: [] })).toBe(false);
    expect(pageContinues(10, { seq: 20, more: true, records: at(11, 12) })).toBe(false);
  });

  it('notices a server that went back (restored from a backup)', () => {
    expect(serverWentBack(10, { seq: 9, more: false })).toBe(true);
    expect(serverWentBack(10, { seq: 10, more: false })).toBe(false);
    expect(serverWentBack(10, { seq: 12, more: false })).toBe(false);
    expect(serverWentBack(10, { seq: 9, more: true })).toBe(false);
  });
});

describe('pushChunks', () => {
  it('splits a push by size and count, never leaving a record out', () => {
    const recs = (n: number, size: number) => Array.from({ length: n }, (_, i) => ({ id: i, data: 'x'.repeat(size) }));
    expect(pushChunks(recs(3, 10), 25).map((c) => c.length)).toEqual([2, 1]);
    expect(pushChunks(recs(2, 100), 25).map((c) => c.length)).toEqual([1, 1]); // larger than the budget: alone
    expect(pushChunks(recs(MAX_PUSH + 1, 1)).map((c) => c.length)).toEqual([MAX_PUSH, 1]);
    expect(pushChunks([{ data: null }, {}]).flat()).toHaveLength(2);
    expect(pushChunks([])).toEqual([]);
  });
});

describe('invite code', () => {
  it('round-trips and rejects junk', async () => {
    const { decodeInviteQr, encodeInviteQr } = await import('../sync');
    const qr = { v: 1 as const, s: 'http://localhost:8787', i: 'id', k: 'secret', d: 'dev', p: 'key' };
    const text = encodeInviteQr(qr);
    expect(text).toMatch(/^subby:[A-Za-z0-9_-]+$/);
    expect(decodeInviteQr(`  ${text}\n`)).toEqual(qr);
    expect(() => decodeInviteQr('subby:!!!')).toThrow('damaged');
    expect(() => decodeInviteQr('https://example.com')).toThrow('Not a Subby code');
  });
});

describe('clock offset', async () => {
  const { clockOff, clockOffset, CLOCK_WARN_MS } = await import('../sync');
  it('measures against the middle of the round trip', () => {
    expect(clockOffset(10_000, 11_000, 10_500)).toBe(0);
    expect(clockOffset(10_000, 11_000, 10_500 - 3_600_000)).toBe(3_600_000); // an hour ahead
    expect(clockOffset(10_000, 11_000, 10_500 + 60_000)).toBe(-60_000); // a minute behind
  });
  it("says nothing when the server didn't, or the answer was too slow to tell", () => {
    expect(clockOffset(10_000, 11_000, undefined)).toBeNull();
    expect(clockOffset(10_000, 50_000, 0)).toBeNull();
    expect(clockOffset(10_000, 9_000, 0)).toBeNull();
  });
  it('warns only past a few minutes, either way', () => {
    expect(clockOff(null)).toBeNull();
    expect(clockOff(CLOCK_WARN_MS)).toBeNull();
    expect(clockOff(-CLOCK_WARN_MS - 1)).toBe(-CLOCK_WARN_MS - 1);
    expect(clockOff(3_600_000)).toBe(3_600_000);
  });
});
