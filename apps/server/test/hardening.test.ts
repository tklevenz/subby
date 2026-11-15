import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RECOVERY_SIGNER, appendEntry, entryHash, newIdentity, newRecoveryWords, seal, toBase64, type DeviceLogEntry, type DeviceLogState } from '@subby/shared/crypto';
import { MAX_FAMILY_DATA_BYTES, MAX_FAMILY_RECORDS, MAX_LOG_ENTRIES } from '@subby/shared/sync';
import { createApp } from '../src/app';
import type { Config } from '../src/config';
import { describeError } from '../src/common/errors';
import { MAX_SESSIONS_PER_DEVICE } from '../src/auth/auth.service';
import { MAX_FAMILY_QUEUE, familyQueue } from '../src/db/lock';
import { DB, type Db } from '../src/db/db';
import { BLOB_TRANSFERS_PER_DEVICE, TransferSlots } from '../src/blobs/transfers';
import { HttpError, TestClient } from './client';

/**
 * Regression tests for the hardening pass (2026-11-14): what one family, or anyone without an account, can cost the
 * server. The real server on a throwaway database, like e2e.test.ts (skipped without the dev Postgres).
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://subby:subby@localhost:54329/subby';
const dbName = `kl_test_${randomUUID().replace(/-/g, '')}`;
const dbUrl = ADMIN_URL.replace(/\/[^/]+$/, `/${dbName}`);
const blobDir = mkdtempSync(join(tmpdir(), 'kl-blobs-'));
const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {}, connect_timeout: 3 });
const reachable = await admin`select 1`.then(
  () => true,
  () => false,
);
if (!reachable) console.warn('\n⚠ Server hardening tests SKIPPED: no Postgres. Run `pnpm --filter @subby/server db:up`.\n');

const config = (over: Partial<Config> = {}): Config => ({
  databaseUrl: dbUrl,
  port: 0,
  mode: 'self',
  migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  blobs: { kind: 'disk', dir: blobDir },
  push: { kind: 'none' },
  rateLimit: false,
  trustProxy: false,
  stores: { google: null, apple: null, test: false },
  ...over,
});

const expectStatus = async (promise: Promise<unknown>, status: number) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).status).toBe(status);
};

/**
 * Sends `request` byte for byte over a plain socket (fetch would drop a `#…` and tidy the path) and resolves with the
 * status line's code once the answer's head arrives. The body may be left unfinished on purpose: the answer must not
 * wait for it.
 */
function raw(base: string, request: string, ms = 3000): Promise<{ status: number; head: string }> {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(port), hostname);
    let data = '';
    const timer = setTimeout(() => (socket.destroy(), reject(new Error('No answer'))), ms);
    socket.on('data', (chunk) => {
      data += chunk.toString('latin1');
      const end = data.indexOf('\r\n\r\n');
      if (end < 0) return;
      clearTimeout(timer);
      socket.destroy();
      resolve({ status: Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1]), head: data.slice(0, end) });
    });
    socket.on('error', (e) => (clearTimeout(timer), reject(e)));
    socket.write(request);
  });
}
const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  `POST ${path} HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n${Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}\r\n`)
    .join('')}Connection: close\r\n\r\n${body}`;

/** `n` recovery-key changes signed by `c`, continuing `log`, built here without replaying the log for each. */
function recoveryChanges(c: TestClient, n: number, log = c.log): DeviceLogEntry[] {
  const keys = newIdentity();
  const entries: DeviceLogEntry[] = [];
  let head = entryHash(log.at(-1)!);
  for (let i = 0; i < n; i++) {
    const entry = appendEntry(
      { head } as DeviceLogState,
      log.length + i,
      { id: c.deviceId, keys: c.identity },
      { type: 'setRecovery', deviceId: RECOVERY_SIGNER, keys: { sign: keys.sign.publicKey, box: keys.box.publicKey } },
      Date.now(),
    );
    entries.push(entry);
    head = entryHash(entry);
  }
  return entries;
}

describe.skipIf(!reachable)('hardening', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let url = '';
  let db: postgres.Sql;

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    db = postgres(dbUrl, { max: 1, onnotice: () => {} });
    app = await createApp(config());
    await app.listen({ port: 0, host: '127.0.0.1' });
    url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
    await db?.end();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
    rmSync(blobDir, { recursive: true, force: true });
  });

  const family = async () => {
    const a = new TestClient(url);
    await a.createFamily();
    return a;
  };

  async function pairedFamily() {
    const a = await family();
    const b = new TestClient(url);
    const { qr, secret } = await a.invite();
    await b.claim(qr);
    await (await a.reviewClaim(qr.i, secret)).approve();
    expect(await b.finishJoin(qr)).toBe(true);
    return { a, b };
  }

  describe('the device log', () => {
    it("checks only the new entries' signatures, so a long log stays quick to append to", async () => {
      const a = await family();
      const entries = recoveryChanges(a, 400);
      const started = Date.now();
      // Re-verifying the whole chain for every entry took minutes here (~0.9 ms per stored entry, per entry).
      await a.request('POST', '/v1/families/me/log/restore', { entries: entries.slice(0, 200) });
      await a.request('POST', '/v1/families/me/log/restore', { entries: entries.slice(200) });
      expect(Date.now() - started).toBeLessThan(5000);
      const { entries: stored } = await a.request<{ entries: DeviceLogEntry[] }>('GET', '/v1/families/me/log');
      expect(stored).toHaveLength(401);
      // New entries are still checked: a forged one is refused.
      const [next] = recoveryChanges(a, 1, stored);
      await expectStatus(a.request('POST', '/v1/families/me/log', { entry: { ...next!, at: next!.at + 1 } }), 400);
      await a.request('POST', '/v1/families/me/log', { entry: next });
    });

    it(`refuses entries past ${MAX_LOG_ENTRIES}`, async () => {
      const a = await family();
      const entries = recoveryChanges(a, MAX_LOG_ENTRIES);
      await expectStatus(a.request('POST', '/v1/families/me/log/restore', { entries }), 409);
      await a.request('POST', '/v1/families/me/log/restore', { entries: entries.slice(0, -1) });
      await expectStatus(a.request('POST', '/v1/families/me/log', { entry: entries.at(-1) }), 409);
    });
  });

  describe('database connections', () => {
    it("refuses grants that repeat an epoch, so a grant can't be longer than the family's epochs", async () => {
      const { a, b } = await pairedFamily();
      const sealed = toBase64(seal(b.identity.box.publicKey, a.familyKeys.get(1)!));
      await expectStatus(a.request('POST', '/v1/keys/grant', { recipient: b.deviceId, keys: [{ epoch: 1, sealed }, { epoch: 1, sealed }] }), 400);
      await expectStatus(a.request('POST', '/v1/keys/grant', { recipient: b.deviceId, keys: [{ epoch: 1, sealed }, { epoch: 2, sealed }] }), 400);
      await a.request('POST', '/v1/keys/grant', { recipient: b.deviceId, keys: [{ epoch: 1, sealed }] });
    });

    it("queues a family's writes before they take a connection, so one family can't hold the others up", async () => {
      const a = await family();
      const other = await family();
      // Hold the family's row lock from outside, so its writes pile up.
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      const holder = db.begin(async (sql) => {
        await sql`select 1 from families where id = ${a.familyId} for update`;
        locked();
        await held;
      });
      try {
        await isLocked;
        const statuses = Array.from({ length: MAX_FAMILY_QUEUE + 12 }, () =>
          a.push([a.seal('log', randomUUID(), {})]).then(
            () => 200,
            (e: unknown) => (e instanceof HttpError ? e.status : 0),
          ),
        );
        const queue = familyQueue(app.get<Db>(DB));
        const until = Date.now() + 3000;
        while (queue.size(a.familyId) < MAX_FAMILY_QUEUE && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
        expect(queue.size(a.familyId)).toBe(MAX_FAMILY_QUEUE);
        // Past the queue: 429 with Retry-After, right away.
        const refused = await fetch(`${url}/v1/sync/push`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${a.token}` },
          body: JSON.stringify({ records: [a.seal('log', randomUUID(), {})] }),
        });
        expect(refused.status).toBe(429);
        expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
        // Another family reads and writes as usual meanwhile (with the pool held, this waited for minutes).
        const started = Date.now();
        await other.request('GET', '/v1/keys');
        await other.push([other.seal('log', randomUUID(), {})]);
        expect(Date.now() - started).toBeLessThan(2000);
        release();
        const answers = await Promise.all(statuses);
        expect(answers.filter((s) => s === 200)).toHaveLength(MAX_FAMILY_QUEUE);
        expect(answers.filter((s) => s === 429)).toHaveLength(12);
      } finally {
        release();
        await holder;
      }
    });

    it('a push writes each record once, the last version of an id that comes twice', async () => {
      const a = await family();
      const id = randomUUID();
      const res = await a.push([a.seal('log', id, { v: 1 }, { updatedAt: 1 }), a.seal('log', randomUUID(), {}), a.seal('log', id, { v: 2 }, { updatedAt: 2 })]);
      expect(res.accepted).toHaveLength(3);
      const pulled = await a.pull();
      expect(pulled).toHaveLength(2);
      expect(pulled.find((p) => p.record.id === id)!.body).toEqual({ v: 2 });
    });
  });

  describe('bodies', () => {
    it("answers a body on GET, HEAD or OPTIONS without reading it, so nobody can make the server parse one", async () => {
      for (const method of ['OPTIONS', 'GET']) {
        // A large body that never finishes: the answer must not wait for it.
        const sized = await raw(url, `${method} /v1/sync/push HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\nContent-Length: 16000000\r\n\r\n{`);
        expect(sized.status).toBe(400);
        const chunked = await raw(url, `${method} /v1/sync/push HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n10\r\n{"records":[{"x`);
        expect(chunked.status).toBe(400);
      }
      // Without a body, as before.
      expect((await fetch(`${url}/v1/info`)).status).toBe(200);
      expect((await fetch(`${url}/v1/sync/push`, { method: 'OPTIONS' })).status).toBe(404);
    });
  });

  describe('rate limits', () => {
    let limited: Awaited<ReturnType<typeof createApp>>;
    let base = '';

    beforeAll(async () => {
      limited = await createApp(config({ rateLimit: true, trustProxy: 'loopback' }));
      await limited.listen({ port: 0, host: '127.0.0.1' });
      base = (await limited.getUrl()).replace('[::1]', '127.0.0.1');
    });
    afterAll(() => limited?.close());

    it("count a request by the route the router matched, however its URL is spelled", async () => {
      const ip = { 'X-Forwarded-For': '198.51.100.20' };
      for (let i = 0; i < 10; i++) expect((await raw(base, post('/v1/families', '{}', ip))).status).toBe(400);
      for (const path of ['/v1/families', '/v1/families#x', '/v1/f%61milies', '/v1/families?x=1', '/v1/families#/../x']) {
        expect((await raw(base, post(path, '{}', ip))).status, path).toBe(429);
      }
      // The router doesn't cut at `;`: that's another path, no route, so it needs a session and never gets to one.
      expect((await raw(base, post('/v1/families;x', '{}', ip))).status).toBe(401);
      // An open route stays open (no session needed) however it's spelled, and an unmatched one never is.
      const other = { 'X-Forwarded-For': '198.51.100.21' };
      expect((await raw(base, post('/v1/auth/challenge#x', '{}', other))).status).toBe(400);
      expect((await raw(base, post('/v1/auth/ch%61llenge', '{}', other))).status).toBe(400);
      expect((await raw(base, post('/v1/nothing-here', '{}', other))).status).toBe(401);
    });

    it('count IPv6 clients by their /64', async () => {
      const challenge = (ip: string) => raw(base, post('/v1/auth/challenge', '{}', { 'X-Forwarded-For': ip }));
      for (let i = 0; i < 30; i++) expect((await challenge(`2001:db8:1:2::${(i + 1).toString(16)}`)).status).toBe(400);
      expect((await challenge('2001:db8:1:2:ffff:ffff:ffff:ffff')).status).toBe(429);
      expect((await challenge('2001:db8:1:3::1')).status).toBe(400);
    });
  });

  describe('photos', () => {
    it('caps photo transfers per phone before reading the body, and frees the slot when one ends', async () => {
      const a = await family();
      // Uploads that send their head and a little of the body, then stall.
      const answered: string[] = [];
      const stalled = Array.from({ length: BLOB_TRANSFERS_PER_DEVICE }, () => {
        const { hostname, port } = new URL(url);
        const socket = connect(Number(port), hostname);
        socket.on('error', () => {});
        socket.on('data', (d) => answered.push(d.toString().split('\r\n')[0]!));
        socket.write(
          `PUT /v1/blobs/${randomUUID()} HTTP/1.1\r\nHost: test\r\nAuthorization: Bearer ${a.token}\r\nContent-Type: application/octet-stream\r\nContent-Length: 1000000\r\n\r\nxxxx`,
        );
        return socket;
      });
      try {
        // Let them all arrive before asking for another.
        await new Promise((r) => setTimeout(r, 300));
        expect(answered).toEqual([]);
        const download = () => fetch(`${url}/v1/blobs/${randomUUID()}`, { headers: { authorization: `Bearer ${a.token}` } });
        let res = await download();
        for (const end = Date.now() + 3000; res.status !== 429 && Date.now() < end; res = await download()) await new Promise((r) => setTimeout(r, 20));
        expect(res.status).toBe(429);
        expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
        // Another phone isn't affected.
        const b = await family();
        expect((await fetch(`${url}/v1/blobs/${randomUUID()}`, { headers: { authorization: `Bearer ${b.token}` } })).status).toBe(404);
      } finally {
        for (const s of stalled) s.destroy();
      }
      // Gone: the slots are free again.
      let res = await fetch(`${url}/v1/blobs/${randomUUID()}`, { headers: { authorization: `Bearer ${a.token}` } });
      for (const end = Date.now() + 3000; res.status !== 404 && Date.now() < end; ) {
        await new Promise((r) => setTimeout(r, 20));
        res = await fetch(`${url}/v1/blobs/${randomUUID()}`, { headers: { authorization: `Bearer ${a.token}` } });
      }
      expect(res.status).toBe(404);
      const ref = await a.uploadFile(new Uint8Array(300_000).fill(7));
      expect((await a.downloadFile(ref)).length).toBe(300_000);
    });

    it('streams downloads with their length', async () => {
      const a = await family();
      const ref = await a.uploadFile(new Uint8Array(2_000_000).fill(1));
      const res = await fetch(`${url}/v1/blobs/${ref.id}`, { headers: { authorization: `Bearer ${a.token}` } });
      expect(res.headers.get('content-type')).toBe('application/octet-stream');
      const length = Number(res.headers.get('content-length'));
      expect(length).toBeGreaterThan(2_000_000);
      expect((await res.arrayBuffer()).byteLength).toBe(length);
    });

    it('caps transfers per family and for the whole server too', () => {
      const slots = new TransferSlots({ perDevice: 2, perFamily: 3, upload: 4, download: 1 });
      const one = slots.take('f', 'a', 'upload');
      expect(typeof one).toBe('function');
      expect(typeof slots.take('f', 'a', 'upload')).toBe('function');
      expect(slots.take('f', 'a', 'upload')).toBe('device');
      expect(typeof slots.take('f', 'b', 'upload')).toBe('function');
      expect(slots.take('f', 'c', 'upload')).toBe('family');
      expect(typeof slots.take('g', 'c', 'upload')).toBe('function');
      expect(slots.take('h', 'd', 'upload')).toBe('server');
      expect(typeof slots.take('h', 'd', 'download')).toBe('function');
      expect(slots.take('i', 'e', 'download')).toBe('server');
      (one as () => void)();
      (one as () => void)(); // twice is once
      expect(slots.size).toBe(4);
      expect(typeof slots.take('f', 'c', 'upload')).toBe('function');
    });
  });

  describe('logs', () => {
    /** Everything the server writes to stdout and stderr while `run` runs. */
    async function captured(run: () => Promise<unknown>) {
      const lines: string[] = [];
      const spies = [
        vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => (lines.push(String(chunk)), true)),
        vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => (lines.push(String(chunk)), true)),
        vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' '))),
        vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' '))),
      ];
      try {
        await run();
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
      return lines.join('\n');
    }

    it('log a failed query without its SQL parameters: no ids, no request data', async () => {
      const a = await family();
      const inviteId = randomUUID();
      const claimHash = toBase64(new Uint8Array(32).fill(9));
      await db`alter table invites rename to invites_gone`;
      let log = '';
      try {
        log = await captured(() => expectStatus(a.request('POST', '/v1/invites', { inviteId, claimHash }), 500));
      } finally {
        await db`alter table invites_gone rename to invites`;
      }
      expect(log).toContain('500 POST /v1/invites');
      expect(log).toContain('42P01');
      for (const secret of [inviteId, a.familyId, claimHash, 'insert into']) expect(log).not.toContain(secret);
    });

    it("log a database error answered as the client's too, so an unexpected conflict isn't silent", async () => {
      const a = await family();
      // A constraint the code doesn't expect to hit: one session per phone.
      await db`delete from sessions where device_id = ${a.deviceId}`;
      await db`create unique index sessions_one_test on sessions (device_id)`;
      let log = '';
      try {
        await a.login();
        log = await captured(() => expectStatus(a.login(), 409));
      } finally {
        await db`drop index sessions_one_test`;
      }
      expect(log).toContain('409 POST /v1/auth/verify from the database');
      expect(log).toContain('23505 table=sessions constraint=sessions_one_test');
      for (const secret of [a.familyId, a.deviceId]) expect(log).not.toContain(secret);
    });

    it('describe an error by its classes, codes and stack only', () => {
      const pg = Object.assign(new Error(`duplicate key value violates unique constraint, Key (id)=(${randomUUID()})`), {
        code: '23505',
        severity: 'ERROR',
        table_name: 'invites',
        constraint_name: 'invites_pkey',
      });
      class DrizzleQueryError extends Error {}
      const text = describeError(new DrizzleQueryError('Failed query: insert into "invites" params: 1234-secret', { cause: pg }));
      expect(text).toMatch(/^DrizzleQueryError ← Error 23505 table=invites constraint=invites_pkey\n\s+at /);
      expect(text).not.toMatch(/secret|Key \(id\)|Failed query/);
    });
  });

  describe('client mistakes are 4xx, never 500', () => {
    it("refuses a family whose first phone uses the recovery key's id", async () => {
      const identity = newIdentity();
      const { newSymmetricKey } = await import('@subby/shared/crypto');
      const key = newSymmetricKey();
      const entry = appendEntry(
        null,
        0,
        { id: RECOVERY_SIGNER, keys: identity },
        { type: 'create', deviceId: RECOVERY_SIGNER, keys: { sign: identity.sign.publicKey, box: identity.box.publicKey }, familyKey: { epoch: 1, key } },
        Date.now(),
      );
      const c = new TestClient(url);
      await expectStatus(c.request('POST', '/v1/families', { familyId: randomUUID(), entry, sealedKey: toBase64(seal(identity.box.publicKey, key)) }), 400);
    });

    it('answers two creates of the same family at once with one family and a 409', async () => {
      const { newSymmetricKey } = await import('@subby/shared/crypto');
      const familyId = randomUUID();
      const create = () => {
        const c = new TestClient(url);
        const key = newSymmetricKey();
        const keys = { sign: c.identity.sign.publicKey, box: c.identity.box.publicKey };
        const entry = appendEntry(null, 0, { id: c.deviceId, keys: c.identity }, { type: 'create', deviceId: c.deviceId, keys, familyKey: { epoch: 1, key } }, Date.now());
        return c.request('POST', '/v1/families', { familyId, entry, sealedKey: toBase64(seal(c.identity.box.publicKey, key)) }).then(
          () => 200,
          (e: unknown) => (e instanceof HttpError ? e.status : 0),
        );
      };
      expect((await Promise.all([create(), create(), create()])).sort()).toEqual([200, 409, 409]);
    });

    it('answers a taken invite id with 409', async () => {
      const a = await family();
      const invite = { inviteId: randomUUID(), claimHash: toBase64(new Uint8Array(32)) };
      await a.request('POST', '/v1/invites', invite);
      await expectStatus(a.request('POST', '/v1/invites', invite), 409);
      await expectStatus((await family()).request('POST', '/v1/invites', invite), 409);
    });

    it('answers a recovery key another family has with 409', async () => {
      const a = await family();
      const b = await family();
      const words = newRecoveryWords();
      await a.setRecovery(words);
      await expectStatus(b.setRecovery(words), 409);
    });

    it('refuses push tokens with characters no token has', async () => {
      const a = await family();
      for (const token of ['abc\u0000def', 'with space', 'tab\there', 'ü']) await expectStatus(a.request('PUT', '/v1/push/token', { token, platform: 'android' }), 400);
      await a.request('PUT', '/v1/push/token', { token: 'fcm:APA91b-x_y', platform: 'android' });
    });
  });

  describe('logins', () => {
    it("keeps a phone's challenge however many others are asked for in its name, and takes each once", async () => {
      const a = await family();
      const { sign: signWith } = await import('@subby/shared/crypto');
      const { authMessage } = await import('@subby/shared/sync');
      const answer = (challenge: string) =>
        a.request<{ token: string }>('POST', '/v1/auth/verify', { challenge, signature: toBase64(signWith(a.identity, authMessage(challenge))) }, '');
      // The phone asks for a challenge, then someone asks for many more for its id (anyone may ask for any id).
      const { challenge } = await a.request<{ challenge: string }>('POST', '/v1/auth/challenge', { deviceId: a.deviceId }, '');
      for (let i = 0; i < 50; i++) await a.request('POST', '/v1/auth/challenge', { deviceId: a.deviceId }, '');
      await answer(challenge);
      // Once only.
      await expectStatus(answer(challenge), 401);
      // Made up, or changed: refused.
      const bytes = Buffer.from(challenge, 'base64url');
      bytes[0] ^= 1;
      await expectStatus(answer(bytes.toString('base64url')), 401);
      await expectStatus(answer(Buffer.from(`device:${a.deviceId}:${Date.now() + 60_000}:${'x'.repeat(48)}`).toString('base64url')), 401);
    });

    it(`keeps the newest ${MAX_SESSIONS_PER_DEVICE} sessions per phone`, async () => {
      const a = await family();
      const tokens: string[] = [];
      for (let i = 0; i < MAX_SESSIONS_PER_DEVICE + 3; i++) tokens.push((await a.login()).token);
      const [{ n }] = await db`select count(*)::int as n from sessions where device_id = ${a.deviceId}`;
      expect(n).toBe(MAX_SESSIONS_PER_DEVICE);
      await expectStatus(a.request('GET', '/v1/keys', undefined, tokens[0]), 401);
      await a.request('GET', '/v1/keys', undefined, tokens.at(-1));
    });

    it('takes the live socket token from a header, and from the URL for older apps', async () => {
      const a = await family();
      for (const inUrl of [false, true]) {
        const live = await a.live({ inUrl });
        await a.push([a.seal('log', randomUUID(), {})]);
        const until = Date.now() + 2000;
        while (!live.messages.some((m) => m.type === 'seq') && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
        expect(live.messages.some((m) => m.type === 'seq')).toBe(true);
        live.close();
      }
      // Neither: closed as unauthorized.
      const none = await new TestClient(url).live().catch(() => null);
      const end = Date.now() + 2000;
      while (none && none.closeCode() !== 4401 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
      expect(none?.closeCode() ?? 4401).toBe(4401);
    });
  });

  it(`caps what one family stores: ${MAX_FAMILY_RECORDS} records and ${MAX_FAMILY_DATA_BYTES / 1024 ** 2} MB of ciphertext`, async () => {
    const a = await family();
    const id = randomUUID();
    await a.push([a.seal('log', id, { note: 'x'.repeat(1000) }, { updatedAt: 1 }), a.seal('log', randomUUID(), {})]);
    const counts = async () => (await db`select record_count, data_bytes from families where id = ${a.familyId}`)[0]!;
    const [{ bytes }] = await db`select sum(length(data))::int as bytes from records where family_id = ${a.familyId}`;
    expect(await counts()).toMatchObject({ record_count: 2, data_bytes: String(bytes) });

    // Nearly full: what grows the family is refused, deleting and shrinking still work.
    await db`update families set record_count = ${MAX_FAMILY_RECORDS}, data_bytes = ${MAX_FAMILY_DATA_BYTES - 10} where id = ${a.familyId}`;
    await expectStatus(a.push([a.seal('log', randomUUID(), {})]), 403);
    await expectStatus(a.push([a.seal('log', id, { note: 'y'.repeat(2000) }, { updatedAt: 2 })]), 403);
    await a.push([a.seal('log', id, { note: 'shorter' }, { updatedAt: 3 })]);
    await a.push([a.seal('log', id, null, { deleted: true, updatedAt: 4 })]);
    const after = await counts();
    expect(after.record_count).toBe(MAX_FAMILY_RECORDS);
    expect(Number(after.data_bytes)).toBeLessThan(MAX_FAMILY_DATA_BYTES - 1000);
  });
});
