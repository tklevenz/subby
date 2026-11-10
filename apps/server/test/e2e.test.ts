import { createVerify, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RECOVERY_SIGNER, fromBase64, newRecoveryWords, recoveryIdentity, toBase64 } from '@subby/shared/crypto';
import { openRecord, type EntitlementResponse } from '@subby/shared/sync';
import { createApp } from '../src/app';
import { BlobsService } from '../src/blobs/blobs';
import { PushService } from '../src/push/push';
import { Housekeeping } from '../src/common/housekeeping';
import { AdminError, runAdmin } from '../src/admin';
import { DB } from '../src/db/db';
import { Entitlements } from '../src/sync/entitlements';
import { HttpError, TestClient } from './client';
import { appleTestSigner } from './appleCerts';

/**
 * End-to-end: the real server on a throwaway Postgres database, driven by simulated apps.
 * Needs the dev database: `pnpm --filter @subby/server db:up`. Skipped (loudly) when it isn't running.
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://subby:subby@localhost:54329/subby';
const dbName = `kl_test_${randomUUID().replace(/-/g, '')}`;
const blobDir = mkdtempSync(join(tmpdir(), 'kl-blobs-'));
const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {}, connect_timeout: 3 });
const reachable = await admin`select 1`.then(
  () => true,
  () => false,
);
if (!reachable) console.warn('\n⚠ Server e2e tests SKIPPED: no Postgres. Run `pnpm --filter @subby/server db:up`.\n');

const until = async (check: () => boolean | Promise<boolean>, ms = 3000) => {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('Timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

const expectStatus = async (promise: Promise<unknown>, status: number) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).status).toBe(status);
};

describe.skipIf(!reachable)('sync server', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let url = '';
  let db: postgres.Sql;

  /**
   * A stand-in for Google: trades a JWT signed with the service-account key for an access token, and records FCM
   * messages sent with it; tokens containing "gone" are unregistered (404).
   */
  const pushed: { to: string; data: unknown; notification?: unknown }[] = [];
  const fcmKey = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  let pushServer: Server;
  let pushUrl = '';

  beforeAll(async () => {
    pushServer = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        if (req.url === '/token') {
          const [head, claims, sig] = new URLSearchParams(raw).get('assertion')!.split('.');
          const valid = createVerify('RSA-SHA256').update(`${head}.${claims}`).verify(fcmKey.publicKey, sig!, 'base64url');
          const { scope } = JSON.parse(Buffer.from(claims!, 'base64url').toString()) as { scope: string };
          res.statusCode = valid && scope.includes('firebase.messaging') ? 200 : 401;
          res.end(JSON.stringify({ access_token: 'fcm-access', expires_in: 3600 }));
          return;
        }
        if (req.headers.authorization !== 'Bearer fcm-access') {
          res.statusCode = 401;
          res.end();
          return;
        }
        const { message } = JSON.parse(raw) as { message: { token: string; data: unknown; notification?: unknown } };
        pushed.push({ to: message.token, data: message.data, notification: message.notification });
        res.statusCode = message.token.includes('gone') ? 404 : 200;
        res.end(JSON.stringify(message.token.includes('gone') ? { error: { status: 'NOT_FOUND' } } : { name: randomUUID() }));
      });
    });
    await new Promise<void>((resolve) => pushServer.listen(0, '127.0.0.1', resolve));
    const address = pushServer.address() as { port: number };
    pushUrl = `http://127.0.0.1:${address.port}`;
    await admin.unsafe(`create database ${dbName}`);
    const dbUrl = ADMIN_URL.replace(/\/[^/]+$/, `/${dbName}`);
    db = postgres(dbUrl, { max: 1, onnotice: () => {} });
    app = await createApp({
      databaseUrl: dbUrl,
      port: 0,
      mode: 'self',
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
      blobs: { kind: 'disk', dir: blobDir },
      // Every simulated phone comes from 127.0.0.1; the limits have their own tests.
      rateLimit: false,
      trustProxy: false,
      stores: { google: null, apple: null, test: false },
      push: {
        kind: 'fcm',
        projectId: 'subby-test',
        clientEmail: 'push@subby-test.iam.gserviceaccount.com',
        privateKey: fcmKey.privateKey,
        tokenUri: `${pushUrl}/token`,
        sendUrl: `${pushUrl}/send`,
      },
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    url = await app.getUrl();
    url = url.replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    pushServer?.close();
    await app?.close();
    await db?.end();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
    rmSync(blobDir, { recursive: true, force: true });
  });

  /** A family with two paired phones, as most tests need. */
  async function pairedFamily(server = url) {
    const a = new TestClient(server);
    await a.createFamily();
    const b = new TestClient(server);
    const { qr, secret } = await a.invite();
    const codeB = await b.claim(qr);
    const { code: codeA, approve } = await a.reviewClaim(qr.i, secret);
    expect(codeA).toBe(codeB);
    expect(await b.finishJoin(qr)).toBe(false);
    await approve();
    expect(await b.finishJoin(qr)).toBe(true);
    return { a, b };
  }

  it('reports health for the uptime monitor', async () => {
    const res = await fetch(`${url}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: true, blobs: true });
  });

  it('creates a family and logs in', async () => {
    const a = new TestClient(url);
    await a.createFamily();
    expect(a.state!.members.has(a.deviceId)).toBe(true);
    expect(a.familyKeys.get(1)).toHaveLength(32);
  });

  it('rejects logins with the wrong key and requests without a token', async () => {
    const a = new TestClient(url);
    await a.createFamily();
    const impostor = new TestClient(url);
    impostor.deviceId = a.deviceId;
    await expectStatus(impostor.login(), 401);
    await expectStatus(new TestClient(url).request('GET', '/v1/sync/pull'), 401);
  });

  it('pairs a second phone by QR code and syncs both ways', async () => {
    const { a, b } = await pairedFamily();
    expect(b.familyKeys.get(1)).toEqual(a.familyKeys.get(1));

    const childId = randomUUID();
    await a.push([a.seal('child', childId, { name: 'Sam' })]);
    const logId = randomUUID();
    await b.push([b.seal('log', logId, { logType: 'diaper', payload: { type: 'diaper', condition: 'wet' } })]);

    expect((await b.pull()).map((r) => r.body)).toContainEqual({ name: 'Sam' });
    expect((await a.pull()).map((r) => r.record.id)).toEqual([childId, logId]);
  });

  it('a mismatched pairing code means a tampered claim', async () => {
    const a = new TestClient(url);
    await a.createFamily();
    const { qr, secret } = await a.invite();
    const b = new TestClient(url);
    await b.claim(qr);
    // A server swapping in its own keys can't produce a valid MAC without the QR secret.
    const [{ claimant }] = await db`select claimant from invites where id = ${qr.i}`;
    await db`update invites set claimant = ${db.json({ ...claimant, boxKey: toBase64(new Uint8Array(32)) })} where id = ${qr.i}`;
    await expect(a.reviewClaim(qr.i, secret)).rejects.toThrow('tampered');
  });

  it('an invite can be claimed once, and only with the QR secret', async () => {
    const a = new TestClient(url);
    await a.createFamily();
    const { qr } = await a.invite();
    await expectStatus(new TestClient(url).claim({ ...qr, k: toBase64(new Uint8Array(32)) }), 404);
    await new TestClient(url).claim(qr);
    await expectStatus(new TestClient(url).claim(qr), 409);

    // Two phones claiming at the same moment: exactly one wins.
    const second = await a.invite();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => new TestClient(url).claim(second.qr)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('rejects malformed paging parameters', async () => {
    const a = new TestClient(url);
    await a.createFamily();
    for (const q of ['since=-1', 'since=abc', 'limit=-1', 'limit=0.5', 'since=1e3']) await expectStatus(a.request('GET', `/v1/sync/pull?${q}`), 400);
    await expectStatus(a.request('GET', '/v1/families/me/log?since=-2'), 400);
    await expectStatus(a.request('GET', '/v1/families/me/log?since=9999999999'), 400);
  });

  it('rejects malformed base64 and oversized fields with 400, not 500', async () => {
    const a = new TestClient(url);
    await a.createFamily();
    const { challenge } = await a.request<{ challenge: string }>('POST', '/v1/auth/challenge', { deviceId: a.deviceId }, '');
    await expectStatus(a.request('POST', '/v1/auth/verify', { challenge, signature: 'a' }, ''), 400);
    await expectStatus(a.request('POST', '/v1/auth/verify', { challenge, signature: 'a'.repeat(5000) }, ''), 400);
    await expectStatus(a.request('POST', '/v1/keys/grant', { recipient: 'recovery', keys: [{ epoch: 2 ** 40, sealed: 'AAAA' }] }), 400);
    expect(await a.request('GET', '/v1/sync/pull?since=0&limit=0')).toMatchObject({ records: [] });
  });

  it('cleans up expired sessions and old invites', async () => {
    const a = new TestClient(url);
    await a.createFamily();
    await a.invite();
    const day = 24 * 3_600_000;
    // Sessions last a week; invites ten minutes plus a day's grace.
    const { sessions, invites } = await app.get(Housekeeping).run(Date.now() + 8 * day);
    expect(sessions).toBeGreaterThan(0);
    expect(invites).toBeGreaterThan(0);
    await expectStatus(a.request('GET', '/v1/sync/pull'), 401);
  });

  it('keeps the newest version and reports stale pushes', async () => {
    const { a, b } = await pairedFamily();
    const id = randomUUID();
    await a.push([a.seal('log', id, { v: 'old' }, { updatedAt: 1000 })]);
    const newer = await b.push([b.seal('log', id, { v: 'new' }, { updatedAt: 2000 })]);
    expect(newer.accepted).toEqual([id]);
    const older = await a.push([a.seal('log', id, { v: 'older' }, { updatedAt: 1500 })]);
    expect(older.stale).toEqual([id]);
    // The winning version comes back with the answer, so a phone needn't pull everything again.
    expect(older.newer.map((r) => r.updatedAt)).toEqual([2000]);
    expect(openRecord(a.familyKeys, older.newer[0])).toEqual({ v: 'new' });
    const pulled = await a.pull();
    expect(pulled.filter((p) => p.record.id === id).at(-1)!.body).toEqual({ v: 'new' });
  });

  it('deletes data on the server: tombstones carry only a sealed empty body', async () => {
    const a = new TestClient(url);
    await a.createFamily();
    const id = randomUUID();
    await a.push([a.seal('log', id, { secret: 'note text' })]);
    await a.push([a.seal('log', id, null, { deleted: true })]);
    const [row] = await db`select data, deleted from records where id = ${id}`;
    expect(row.deleted).toBe(true);
    expect(fromBase64(row.data).length).toBeLessThan(64);
  });

  it("the server can't delete on its own: unsealed tombstones are refused", async () => {
    const { a, b } = await pairedFamily();
    const id = randomUUID();
    await a.push([a.seal('log', id, { keep: 'me' }, { updatedAt: 1000 })]);
    expect((await b.pull()).map((p) => p.record.id)).toContain(id);
    // The server turns it into a newer tombstone without data (it has no key to seal one).
    await db`update records set deleted = true, data = null, updated_at = 2000, seq = seq + 100 where id = ${id}`;
    await db`update families set seq = seq + 100 where id = ${a.familyId}`;
    expect(await b.pull()).toEqual([]);
    expect(b.rejected).toContain(id);
    // Older apps still push tombstones without data; the server takes them, phones ignore them.
    const legacy = { ...a.seal('log', randomUUID(), null, { deleted: true }), data: null };
    expect((await a.push([legacy])).accepted).toEqual([legacy.id]);
  });

  it("a removed phone can't write under its old key, even with the server's help", async () => {
    const { a, b } = await pairedFamily();
    await a.push([a.seal('log', randomUUID(), { before: 'removal' })]);
    const oldKey = b.seal('log', randomUUID(), { forged: true });
    await a.removeDevice(b.deviceId);
    const closed = a.state!.closedAt.get(1)!;
    expect(closed).toBe(a.lastSeq);

    // The server refuses it (b is out)...
    await expectStatus(b.push([oldKey]), 401);
    // ...but a hostile server stores it anyway, after the seq the log closed epoch 1 at.
    await db`insert into records (family_id, id, kind, epoch, updated_at, device_id, deleted, data, seq)
      values (${a.familyId}, ${oldKey.id}, 'log', 1, ${oldKey.updatedAt}, ${oldKey.deviceId}, false, ${oldKey.data}, ${closed + 5})`;
    await db`update families set seq = ${closed + 5} where id = ${a.familyId}`;
    expect((await a.pull()).map((p) => p.record.id)).not.toContain(oldKey.id);
    expect(a.rejected).toContain(oldKey.id);
  });

  it('a rotation closes the old epochs only at the latest seq', async () => {
    const { a, b } = await pairedFamily();
    await a.pull();
    // Another phone pushes after a pulled: an entry claiming a's seq would hide b's record, so the server refuses it.
    await b.push([b.seal('log', randomUUID(), { late: true })]);
    const { appendEntry, newSymmetricKey, seal } = await import('@subby/shared/crypto');
    const key = newSymmetricKey();
    const entry = appendEntry(a.state, a.log.length, { id: a.deviceId, keys: a.identity }, {
      type: 'epoch',
      deviceId: a.deviceId,
      familyKey: { epoch: 2, key },
      closedSeq: a.lastSeq,
    }, Date.now());
    const sealed = Object.fromEntries([...a.state!.members].map(([id, m]) => [id, toBase64(seal(m.boxKey, key))]));
    await expectStatus(a.request('POST', '/v1/keys/rotate', { entry, sealed }), 409);
    // rotate() pulls first, so it closes at the latest seq and b's record stays valid.
    await a.rotate();
    expect(a.state!.closedAt.get(1)).toBe(a.lastSeq);
    await b.refresh();
    b.lastSeq = 0;
    expect((await b.pull()).some((p) => (p.body as { late?: boolean } | null)?.late)).toBe(true);
    expect(b.rejected).toEqual([]);
  });

  it('pages through long histories', async () => {
    const a = new TestClient(url);
    await a.createFamily();
    const records = Array.from({ length: 450 }, (_, i) => a.seal('log', randomUUID(), { i }));
    await a.push(records);
    const b = new TestClient(url);
    Object.assign(b, { deviceId: a.deviceId, identity: a.identity, token: a.token, familyKeys: a.familyKeys, state: a.state });
    expect(await b.pull()).toHaveLength(450);
  });

  it('only accepts records written as the calling device, with the current key', async () => {
    const { a, b } = await pairedFamily();
    const forged = { ...b.seal('log', randomUUID(), {}), deviceId: a.deviceId };
    await expectStatus(b.push([forged]), 403);
    await expectStatus(a.push([{ ...a.seal('log', randomUUID(), {}), epoch: 7 }]), 400);
  });

  it('removing a device locks it out and rotates the key', async () => {
    const { a, b } = await pairedFamily();
    const live = await b.live();
    await a.removeDevice(b.deviceId);
    await until(() => live.closeCode() === 4401);

    await expectStatus(b.pull(), 401);
    await expectStatus(b.login(), 404);
    expect(a.currentEpoch).toBe(2);
    // New data is under epoch 2, which b never received.
    await a.push([a.seal('log', randomUUID(), { after: 'removal' })]);
    const [row] = await db`select epoch from records where family_id = ${a.familyId} order by seq desc limit 1`;
    expect(row.epoch).toBe(2);
    // The server refuses a rotation that leaves out or adds anyone, and epochs without their keys.
    const { appendEntry, newSymmetricKey } = await import('@subby/shared/crypto');
    await a.pull();
    const entry = appendEntry(a.state, a.log.length, { id: a.deviceId, keys: a.identity }, {
      type: 'epoch',
      deviceId: a.deviceId,
      familyKey: { epoch: 3, key: newSymmetricKey() },
      closedSeq: a.lastSeq,
    }, Date.now());
    await expectStatus(a.request('POST', '/v1/keys/rotate', { entry, sealed: {} }), 400);
    await expectStatus(a.request('POST', '/v1/families/me/log', { entry }), 400);
  });

  it("a phone removed between challenge and verify doesn't get a session", async () => {
    const { a, b } = await pairedFamily();
    const { challenge } = await b.request<{ challenge: string }>('POST', '/v1/auth/challenge', { deviceId: b.deviceId }, '');
    await a.removeDevice(b.deviceId);
    const { authMessage } = await import('@subby/shared/sync');
    const { sign } = await import('@subby/shared/crypto');
    await expectStatus(b.request('POST', '/v1/auth/verify', { challenge, signature: toBase64(sign(b.identity, authMessage(challenge))) }, ''), 401);
    const [{ n }] = await db`select count(*)::int as n from sessions where device_id = ${b.deviceId}`;
    expect(n).toBe(0);
  });

  it('a rotation must say where it closes the old epochs', async () => {
    const { a } = await pairedFamily();
    await a.pull();
    const { appendEntry, newSymmetricKey, seal } = await import('@subby/shared/crypto');
    const key = newSymmetricKey();
    const entry = appendEntry(a.state, a.log.length, { id: a.deviceId, keys: a.identity }, { type: 'epoch', deviceId: a.deviceId, familyKey: { epoch: 2, key } }, Date.now());
    const sealed = Object.fromEntries([...a.state!.members].map(([id, m]) => [id, toBase64(seal(m.boxKey, key))]));
    await expectStatus(a.request('POST', '/v1/keys/rotate', { entry, sealed }), 409);
  });

  it("phones refuse family keys the server made up or swapped", async () => {
    const { a, b } = await pairedFamily();
    const { newSymmetricKey, seal } = await import('@subby/shared/crypto');
    const fake = () => toBase64(seal(b.identity.box.publicKey, newSymmetricKey()));

    // A new epoch, but the server hands b its own key instead of the one a sealed.
    await a.rotate();
    await db`update family_keys set sealed = ${fake()} where family_id = ${a.familyId} and recipient = ${b.deviceId} and epoch = 2`;
    await expect(b.refresh()).rejects.toThrow('not the one the family made');

    // An epoch no device ever started.
    const c = (await pairedFamily()).b;
    await db`update families set current_epoch = 2 where id = ${c.familyId}`;
    await db`insert into family_keys (family_id, epoch, recipient, sealed) values (${c.familyId}, 2, ${c.deviceId}, ${toBase64(seal(c.identity.box.publicKey, newSymmetricKey()))})`;
    await expect(c.refresh()).rejects.toThrow('no key for epoch 2');
    expect(c.currentEpoch).toBe(1);
  });

  it('phones give back device log entries the server lost, and never accept the shorter log', async () => {
    const { a, b } = await pairedFamily();
    await a.rotate();
    await b.refresh();
    expect(b.currentEpoch).toBe(2);
    // The server loses the epoch entry (or drops it, hoping b goes back to the old key): b puts it back.
    await db`delete from device_log where family_id = ${a.familyId} and index = ${a.log.length - 1}`;
    await db`update families set current_epoch = 1 where id = ${a.familyId}`;
    await b.refresh();
    expect(b.currentEpoch).toBe(2);
    expect((await db`select current_epoch from families where id = ${a.familyId}`)[0]!.current_epoch).toBe(2);
    // A server that won't take it back can't make b use the shorter log either.
    await db`delete from device_log where family_id = ${a.familyId} and index = ${a.log.length - 1}`;
    const restore = b.request.bind(b);
    b.request = (async (method: string, path: string, body?: unknown) =>
      path.endsWith('/log/restore') ? Promise.reject(new HttpError(500, 'no')) : restore(method, path, body)) as typeof b.request;
    await expect(b.refresh()).rejects.toThrow();
    b.request = restore;
  });

  it("restored entries must continue the server's log and be signed", async () => {
    const { a, b } = await pairedFamily();
    await a.rotate();
    const epoch = a.log.at(-1)!;
    // Not continuing the log (the server already has it), forged, or a new family's first entry.
    await expectStatus(b.request('POST', '/v1/families/me/log/restore', { entries: [epoch] }), 400);
    await db`delete from device_log where family_id = ${a.familyId} and index = ${epoch.index}`;
    await expectStatus(b.request('POST', '/v1/families/me/log/restore', { entries: [{ ...epoch, closedSeq: 99 }] }), 400);
    await expectStatus(b.request('POST', '/v1/families/me/log/restore', { entries: [a.log[0]] }), 400);
    await b.request('POST', '/v1/families/me/log/restore', { entries: [epoch] });
  });

  it('a server restored from a backup gets back from the phones what it lost', async () => {
    const { a, b } = await pairedFamily();
    const before = a.seal('log', randomUUID(), { before: 'backup' });
    await a.push([before]);
    await b.refresh();
    await b.pull();

    // The nightly backup.
    const tables = ['devices', 'device_log', 'family_keys', 'sessions', 'invites', 'blobs', 'push_tokens', 'records', 'purchases'];
    const backup: Record<string, Record<string, unknown>[]> = { families: [...(await db`select * from families where id = ${a.familyId}`)] };
    for (const t of tables) backup[t] = [...(await db`select * from ${db(t)} where family_id = ${a.familyId}`)];

    // After it: a third phone joins, a writes, then removes b (closing epoch 1 after that record).
    const c = new TestClient(url);
    const { qr, secret } = await a.invite();
    await c.claim(qr);
    await (await a.reviewClaim(qr.i, secret)).approve();
    expect(await c.finishJoin(qr)).toBe(true);
    const after = a.seal('log', randomUUID(), { after: 'backup' });
    await a.push([after]);
    await a.pull();
    await a.removeDevice(b.deviceId);
    expect(a.state!.closedAt.get(1)).toBe(2);
    await c.refresh();
    await c.pull();

    // The server dies and comes back from the backup.
    await db`delete from families where id = ${a.familyId}`;
    for (const t of ['families', ...tables]) if (backup[t]!.length) await db`insert into ${db(t)} ${db(backup[t]!)}`;
    await runAdmin(app.get(DB), app.get(Entitlements), ['restored'], () => {});

    // In the meantime b, a member again as far as the server knows, writes with the key it still has. Its seq (2)
    // is within what the log let epoch 1 have: only the restore's floor tells it from genuine history.
    await b.login();
    const evil = b.seal('log', randomUUID(), { written: 'after the backup' });
    expect((await b.push([evil])).seq).toBe(2);
    // c joined after the backup: the server doesn't know it yet.
    await expectStatus(c.login(), 404);

    // a's next run gives back the log (c's add, b's removal, the epoch), then grants what's missing.
    await a.login();
    await a.refresh();
    await a.heal();
    expect(a.log).toHaveLength(5);
    await expectStatus(b.login(), 404);
    // Its pull notices the restore: everything again, without b's old-key record, then a pushes all it has.
    const pulled = await a.pull();
    expect(a.resynced).toBe(true);
    expect(pulled.map((p) => p.record.id)).toEqual([before.id]);
    expect(a.rejected).toContain(evil.id);
    await a.push([a.seal('log', before.id, { before: 'backup' }, { updatedAt: before.updatedAt }), a.seal('log', after.id, { after: 'backup' }, { updatedAt: after.updatedAt })]);

    // c is back in, with its key, and gets everything.
    await c.login();
    await c.refresh();
    const atC = await c.pull();
    expect(c.resynced).toBe(true);
    expect(atC.map((p) => p.record.id).sort()).toEqual([before.id, after.id].sort());
    expect(c.rejected).toContain(evil.id);
  });

  it('a phone approved without its keys gets them on the next sync of any other phone', async () => {
    const a = new TestClient(url);
    await a.createFamily();
    const b = new TestClient(url);
    const { qr, secret } = await a.invite();
    await b.claim(qr);
    const invite = await a.request<{ claimant: { deviceId: string; signKey: string; boxKey: string } }>('GET', `/v1/invites/${qr.i}`);
    const c = invite.claimant;
    // The approval stopped after the log entry: no grant.
    await a.append({ type: 'add', deviceId: c.deviceId, keys: { sign: fromBase64(c.signKey), box: fromBase64(c.boxKey) } });
    expect(await b.finishJoin(qr)).toBe(true);
    expect(b.familyKeys.size).toBe(0);
    await a.refresh();
    expect(a.missing).toEqual([{ recipient: b.deviceId, epochs: [1] }]);
    await a.heal();
    await b.refresh();
    expect(b.familyKeys.get(1)).toEqual(a.familyKeys.get(1));
    expect(a.missing).toEqual([]);
  });

  it('a removal whose rotation failed is finished by the next sync', async () => {
    const { a, b } = await pairedFamily();
    await a.append({ type: 'remove', deviceId: b.deviceId }); // and then the app was killed
    await a.refresh();
    expect(a.state!.rotationDue).toBe(true);
    await a.heal();
    expect(a.currentEpoch).toBe(2);
    expect(a.state!.rotationDue).toBe(false);
  });

  it('replacing the recovery key starts a new epoch, sealed to the new words only', async () => {
    const { a, b } = await pairedFamily();
    const oldWords = newRecoveryWords();
    await a.setRecovery(oldWords);
    const newWords = newRecoveryWords();
    await a.setRecovery(newWords);
    await a.heal();
    expect(a.currentEpoch).toBe(2);
    await b.refresh();
    expect(b.familyKeys.get(2)).toEqual(a.familyKeys.get(2));
    const [row] = await db`select count(*)::int as n from family_keys where family_id = ${a.familyId} and recipient = ${RECOVERY_SIGNER} and epoch = 2`;
    expect(row.n).toBe(1);
    // The new words still recover everything.
    await a.push([a.seal('log', randomUUID(), { after: 'replace' })]);
    const fresh = new TestClient(url);
    await fresh.recover(newWords);
    expect((await fresh.pull()).map((r) => r.body)).toContainEqual({ after: 'replace' });
  });

  it("a grant can't replace a key someone already has", async () => {
    const { a, b } = await pairedFamily();
    const [before] = await db`select sealed from family_keys where family_id = ${a.familyId} and recipient = ${b.deviceId} and epoch = 1`;
    const { newSymmetricKey, seal } = await import('@subby/shared/crypto');
    await a.request('POST', '/v1/keys/grant', { recipient: b.deviceId, keys: [{ epoch: 1, sealed: toBase64(seal(b.identity.box.publicKey, newSymmetricKey())) }] });
    const [after] = await db`select sealed from family_keys where family_id = ${a.familyId} and recipient = ${b.deviceId} and epoch = 1`;
    expect(after.sealed).toBe(before.sealed);
  });

  it('rejects device log entries that are forged or out of order', async () => {
    const a = new TestClient(url);
    await a.createFamily();
    const outsider = new TestClient(url);
    const { appendEntry } = await import('@subby/shared/crypto');
    const forged = appendEntry(a.state, a.log.length, { id: a.deviceId, keys: outsider.identity }, {
      type: 'add',
      deviceId: outsider.deviceId,
      keys: { sign: outsider.identity.sign.publicKey, box: outsider.identity.box.publicKey },
    }, Date.now());
    await expectStatus(a.request('POST', '/v1/families/me/log', { entry: forged }), 400);
  });

  it('recovers a family with only the recovery words', async () => {
    const a = new TestClient(url);
    await a.createFamily();
    const words = newRecoveryWords();
    await a.setRecovery(words);
    await a.push([a.seal('child', randomUUID(), { name: 'Sam' })]);

    // Every phone is lost; a fresh install has only the words.
    const fresh = new TestClient(url);
    await fresh.recover(words);
    expect(fresh.state!.members.has(fresh.deviceId)).toBe(true);
    expect((await fresh.pull()).map((r) => r.body)).toEqual([{ name: 'Sam' }]);

    // The recovery key can enroll, but not sync or rotate by itself.
    const rec = new TestClient(url);
    const { recoveryIdentity } = await import('@subby/shared/crypto');
    const id = recoveryIdentity(words);
    await rec.login(id, { recoverySignKey: toBase64(id.sign.publicKey) });
    await expectStatus(rec.request('GET', '/v1/sync/pull'), 403);
    await expectStatus(rec.request('POST', '/v1/keys/rotate', { entry: fresh.log[0], sealed: {} }), 403);
    // Nor grant to anyone but the phone it added: grants are first-come, so it could hand out keys that don't open.
    await expectStatus(rec.request('POST', '/v1/keys/grant', { recipient: a.deviceId, keys: [{ epoch: 1, sealed: 'AAAA' }] }), 403);
    await expectStatus(rec.request('POST', '/v1/keys/grant', { recipient: 'recovery', keys: [{ epoch: 1, sealed: 'AAAA' }] }), 403);
  });

  it('after a recovery, the lost phones are removed with one new epoch', async () => {
    const { a, b } = await pairedFamily();
    const words = newRecoveryWords();
    await a.setRecovery(words);

    // Both phones are lost. The recovered phone removes them in one go: two removes, then a single rotation.
    const fresh = new TestClient(url);
    await fresh.recover(words);
    expect([...fresh.state!.members.keys()].sort()).toEqual([a.deviceId, b.deviceId, fresh.deviceId].sort());
    await fresh.removeDevices([a.deviceId, b.deviceId]);
    expect([...fresh.state!.members.keys()]).toEqual([fresh.deviceId]);
    expect(fresh.state!.epoch).toBe(2);
    expect(fresh.state!.rotationDue).toBe(false);

    // The lost phones can't sign in any more (no longer members); the words still recover the new epoch.
    await expectStatus(a.login(), 404);
    await expectStatus(b.login(), 404);
    await fresh.push([fresh.seal('log', randomUUID(), { after: 'recovery' })]);
    const again = new TestClient(url);
    await again.recover(words);
    expect(again.familyKeys.has(2)).toBe(true);
    expect((await again.pull()).map((r) => r.body)).toContainEqual({ after: 'recovery' });
  });

  it('rotations include the recovery key, so recovery still works afterwards', async () => {
    const { a, b } = await pairedFamily();
    const words = newRecoveryWords();
    await a.setRecovery(words);
    await a.removeDevice(b.deviceId);
    await a.push([a.seal('log', randomUUID(), { epoch: 2 })]);
    const fresh = new TestClient(url);
    await fresh.recover(words);
    expect(fresh.familyKeys.has(2)).toBe(true);
    expect((await fresh.pull()).map((r) => r.body)).toContainEqual({ epoch: 2 });
  });

  it('notifies open apps live', async () => {
    const { a, b } = await pairedFamily();
    const live = await b.live();
    await a.push([a.seal('log', randomUUID(), {})]);
    await until(() => live.messages.some((m) => m.type === 'seq'));
    live.close();
  });

  it('never stores readable data', async () => {
    const { a } = await pairedFamily();
    await a.push([a.seal('child', randomUUID(), { name: 'Zebediah Plaintextson', notes: 'allergic to peanuts' })]);
    const dump = JSON.stringify(await db`select * from records`) + JSON.stringify(await db`select * from device_log`);
    expect(dump).not.toMatch(/Zebediah|Plaintextson|peanuts/);
  });

  describe('push', () => {
    const register = (c: TestClient, token: string, platform = 'android') => c.request('PUT', '/v1/push/token', { token, platform });
    const tokensOf = async (familyId: string) => (await db`select token from push_tokens where family_id = ${familyId}`).map((r) => r.token as string);

    it('says whether it sends pushes', async () => {
      expect(await new TestClient(url).request('GET', '/v1/info')).toMatchObject({ push: true });
    });

    it("wakes the family's other phones with a content-free ping after a write", async () => {
      const { a, b } = await pairedFamily();
      const tokenA = `fcm-a-${randomUUID()}`;
      const tokenB = `fcm-b-${randomUUID()}`;
      await register(a, tokenA);
      await register(b, tokenB);
      await a.push([a.seal('log', randomUUID(), { secret: 'Zebediah' })]);
      await until(() => pushed.some((m) => m.to === tokenB), 5000);
      const toB = pushed.filter((m) => m.to === tokenB);
      expect(toB).toHaveLength(1);
      expect(toB[0]).toMatchObject({ data: { kind: 'sync' } });
      expect(toB[0]!.notification).toBeUndefined();
      expect(JSON.stringify(toB)).not.toMatch(/Zebediah/);
      expect(pushed.some((m) => m.to === tokenA)).toBe(false); // the writer itself isn't woken
    });

    it('drops tokens the push service no longer knows, and those of removed phones', async () => {
      const { a, b } = await pairedFamily();
      await register(a, `fcm-gone-${randomUUID()}`);
      await register(b, `fcm-b-${randomUUID()}`);
      expect(await tokensOf(a.familyId)).toHaveLength(2);
      await app.get(PushService).send(a.familyId, null);
      expect(await tokensOf(a.familyId)).toHaveLength(1);
      await a.removeDevice(b.deviceId);
      expect(await tokensOf(a.familyId)).toHaveLength(0);
    });

    it('keeps iOS tokens but sends only to Android ones (no APNs yet)', async () => {
      const { a, b } = await pairedFamily();
      await register(b, `apns-${randomUUID()}`, 'ios');
      expect(await app.get(PushService).send(a.familyId, a.deviceId)).toBe(0);
      expect(await tokensOf(a.familyId)).toHaveLength(1);
    });

    it('a phone can replace or remove its token', async () => {
      const { a } = await pairedFamily();
      await register(a, 'fcm-one');
      await register(a, 'fcm-two');
      expect(await tokensOf(a.familyId)).toEqual(['fcm-two']);
      await a.request('DELETE', '/v1/push/token');
      expect(await tokensOf(a.familyId)).toEqual([]);
    });
  });

  describe('photos', () => {
    const photo = (text: string) => new TextEncoder().encode(`JPEG ${text} `.repeat(30_000)); // ~300 KB, several chunks
    const exists = (c: TestClient, id: string) =>
      c.downloadFile({ id, key: 'x' }).then(
        () => true,
        (e: unknown) => !(e instanceof HttpError && e.status === 404),
      );

    it('syncs an encrypted photo to the other phone', async () => {
      const { a, b } = await pairedFamily();
      const ref = await a.uploadFile(photo('baby'));
      const id = randomUUID();
      await a.push([a.seal('child', id, { name: 'Ada', photoBlob: ref }, { blobs: [ref.id] })]);
      const [pulled] = (await b.pull()).filter((p) => p.record.id === id);
      const got = await b.downloadFile((pulled!.body as { photoBlob: { id: string; key: string } }).photoBlob);
      expect(new TextDecoder().decode(got.subarray(0, 9))).toBe('JPEG baby');
      expect(got.length).toBe(photo('baby').length);
    });

    it('stores only ciphertext', async () => {
      const { a } = await pairedFamily();
      const ref = await a.uploadFile(photo('secretface'));
      const files = readdirSync(blobDir, { recursive: true, withFileTypes: true }).filter((f) => f.isFile() && f.name === ref.id);
      expect(files).toHaveLength(1);
      expect(readFileSync(join(files[0]!.parentPath, files[0]!.name)).toString('latin1')).not.toMatch(/secretface|JPEG/);
    });

    it("deletes a record's old photo when it changes and all of them when it's deleted", async () => {
      const { a } = await pairedFamily();
      const id = randomUUID();
      const first = await a.uploadFile(photo('one'));
      await a.push([a.seal('child', id, { photoBlob: first }, { blobs: [first.id], updatedAt: 1 })]);
      // An edit that leaves the list out keeps the photo (older apps don't send it).
      await a.push([a.seal('child', id, { photoBlob: first, name: 'edited' }, { updatedAt: 2 })]);
      expect(await exists(a, first.id)).toBe(true);

      const second = await a.uploadFile(photo('two'));
      await a.push([a.seal('child', id, { photoBlob: second }, { blobs: [second.id], updatedAt: 3 })]);
      expect(await exists(a, first.id)).toBe(false);
      expect(await exists(a, second.id)).toBe(true);

      await a.push([a.seal('child', id, null, { deleted: true, updatedAt: 4 })]);
      expect(await exists(a, second.id)).toBe(false);
      const [{ n }] = await db`select count(*)::int as n from blobs where id in (${first.id}, ${second.id})`;
      expect(n).toBe(0);
    });

    it('a stale push does not touch the photos of the newer version', async () => {
      const { a, b } = await pairedFamily();
      const id = randomUUID();
      const kept = await a.uploadFile(photo('kept'));
      await a.push([a.seal('child', id, { photoBlob: kept }, { blobs: [kept.id], updatedAt: 10 })]);
      const res = await b.push([b.seal('child', id, {}, { blobs: [], updatedAt: 5 })]);
      expect(res.stale).toEqual([id]);
      expect(await exists(a, kept.id)).toBe(true);
    });

    it('sweeps uploads that no record lists', async () => {
      const { a } = await pairedFamily();
      const orphan = await a.uploadFile(photo('orphan'));
      const linked = await a.uploadFile(photo('linked'));
      await a.push([a.seal('log', randomUUID(), { photoBlob: linked }, { blobs: [linked.id] })]);
      const sweeper = app.get(BlobsService);
      await sweeper.sweep(Date.now());
      expect(await exists(a, orphan.id)).toBe(true); // still within the grace period
      await sweeper.sweep(Date.now() + 25 * 60 * 60 * 1000);
      expect(await exists(a, orphan.id)).toBe(false);
      expect(await exists(a, linked.id)).toBe(true);
    });

    it("other families and removed phones can't download", async () => {
      const { a, b } = await pairedFamily();
      const ref = await a.uploadFile(photo('private'));
      const stranger = new TestClient(url);
      await stranger.createFamily();
      await expectStatus(stranger.downloadFile(ref), 404);
      await a.removeDevice(b.deviceId);
      await expectStatus(b.downloadFile(ref), 401);
    });

    it("a record can't take over another record's photo", async () => {
      const { a, b } = await pairedFamily();
      const ref = await a.uploadFile(photo('mine'));
      await a.push([a.seal('child', randomUUID(), { photoBlob: ref }, { blobs: [ref.id] })]);
      // Another record lists it, then drops it: the photo stays with the first record.
      const other = randomUUID();
      await b.push([b.seal('log', other, {}, { blobs: [ref.id], updatedAt: 1 })]);
      await b.push([b.seal('log', other, {}, { blobs: [], updatedAt: 2 })]);
      expect(await exists(a, ref.id)).toBe(true);
    });

    it("a taken id is refused before the stored file is touched, from another family too", async () => {
      const { a } = await pairedFamily();
      const ref = await a.uploadFile(photo('original'));
      const stranger = new TestClient(url);
      await stranger.createFamily();
      const res = await fetch(`${url}/v1/blobs/${ref.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${stranger.token}` },
        body: new Uint8Array([1, 2, 3]),
      });
      expect(res.status).toBe(409);
      const got = await a.downloadFile(ref);
      expect(new TextDecoder().decode(got.subarray(0, 13))).toBe('JPEG original');
    });

    it('rejects ids that are taken, empty bodies and missing auth', async () => {
      const { a } = await pairedFamily();
      const ref = await a.uploadFile(photo('x'));
      const put = (id: string, body: Uint8Array<ArrayBuffer>, token = a.token) =>
        fetch(`${url}/v1/blobs/${id}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token}` }, body });
      expect((await put(ref.id, new Uint8Array([1]))).status).toBe(409);
      expect((await put(randomUUID(), new Uint8Array())).status).toBe(400);
      expect((await put(randomUUID(), new Uint8Array([1]), '')).status).toBe(401);
    });
  });

  describe('moving to another server', () => {
    let other: Awaited<ReturnType<typeof createApp>>;
    let otherUrl = '';
    const otherDbName = `${dbName}_moved`;
    const otherBlobs = mkdtempSync(join(tmpdir(), 'kl-blobs-moved-'));

    beforeAll(async () => {
      await admin.unsafe(`create database ${otherDbName}`);
      other = await createApp({
        databaseUrl: ADMIN_URL.replace(/\/[^/]+$/, `/${otherDbName}`),
        port: 0,
        mode: 'self',
        migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
        blobs: { kind: 'disk', dir: otherBlobs },
        push: { kind: 'none' },
        rateLimit: false,
        trustProxy: false,
        stores: { google: null, apple: null, test: false },
      });
      await other.listen({ port: 0, host: '127.0.0.1' });
      otherUrl = (await other.getUrl()).replace('[::1]', '127.0.0.1');
    });

    afterAll(async () => {
      await other?.close();
      await admin.unsafe(`drop database if exists ${otherDbName} with (force)`);
      rmSync(otherBlobs, { recursive: true, force: true });
    });

    it('moves a family with its photos; the other phone follows without pairing, and the old family is deleted', async () => {
      const { a, b } = await pairedFamily();
      const oldFamily = a.familyId;
      const words = newRecoveryWords();
      await a.setRecovery(words);
      const photo = new Uint8Array([1, 2, 3, 4, 5]);
      const ref = await a.uploadFile(photo);
      const note = a.seal('log', randomUUID(), { text: 'first', photoBlob: ref }, { blobs: [ref.id] });
      await a.push([note]);
      await b.pull();

      const a2 = await a.moveTo(otherUrl, [{ ...ref, data: photo }]);
      // The mover sends its copy of everything, sealed with the new key; the photo keeps its id and key.
      await a2.push([a2.seal('log', note.id, { text: 'first', photoBlob: ref }, { updatedAt: note.updatedAt, blobs: [ref.id] })]);
      // b writes to the old family before it notices the move: that one it sends again itself.
      const late = b.seal('log', randomUUID(), { text: 'late' });
      await b.push([late]);

      const { next: b2, resend } = await b.follow();
      expect(resend).toEqual([late.id]);
      await b2.push([b2.seal('log', late.id, { text: 'late' }, { updatedAt: late.updatedAt })]);
      expect((await b2.pull()).map((p) => p.record.id).sort()).toEqual([note.id, late.id].sort());
      expect(await b2.downloadFile(ref)).toEqual(photo);
      expect([...b2.state!.members.keys()].sort()).toEqual([a.deviceId, b.deviceId].sort());

      // Both left the old family, so it's gone from the old server.
      expect(await db`select id from families where id = ${oldFamily}`).toHaveLength(0);
      // The recovery words work on the new server.
      const c = new TestClient(otherUrl);
      await c.recover(words);
      expect(c.state!.members.has(c.deviceId)).toBe(true);
    });
  });

  describe('deleting a family', () => {
    const tables = ['families', 'device_log', 'devices', 'family_keys', 'sessions', 'invites', 'blobs', 'push_tokens', 'records'];
    /** Rows left for the family, per table (the families table is keyed by id). */
    const leftovers = async (familyId: string) => {
      const counts: Record<string, number> = {};
      for (const t of tables) {
        const [row] = await db.unsafe(`select count(*)::int as n from ${t} where ${t === 'families' ? 'id' : 'family_id'} = $1`, [familyId]);
        if (row!.n) counts[t] = row!.n as number;
      }
      return counts;
    };
    const storedFile = (id: string) => readdirSync(blobDir, { recursive: true, withFileTypes: true }).some((f) => f.isFile() && f.name === id);

    /** A family with data in every table: records, a photo, a push token, an open invite, a recovery key. */
    async function fullFamily() {
      const { a, b } = await pairedFamily();
      const ref = await a.uploadFile(new TextEncoder().encode('JPEG of the family'));
      await a.push([a.seal('child', randomUUID(), { name: 'Sam' }, { blobs: [ref.id] })]);
      await b.request('PUT', '/v1/push/token', { token: 'fcm-b', platform: 'android' });
      await a.invite();
      const words = newRecoveryWords();
      await a.setRecovery(words);
      expect(Object.keys(await leftovers(a.familyId))).toEqual(expect.arrayContaining(tables));
      expect(storedFile(ref.id)).toBe(true);
      return { a, b, ref, words };
    }

    it('any member can delete everything the server holds for the family', async () => {
      const { a, b, ref, words } = await fullFamily();
      const socket = await b.live();
      await a.request('DELETE', '/v1/families/me');
      expect(await leftovers(a.familyId)).toEqual({});
      expect(storedFile(ref.id)).toBe(false);
      await until(() => socket.closeCode() === 4401);
      // The other phone, and the recovery words, can't log in any more (as if removed).
      await expectStatus(b.login(), 404);
      await expectStatus(new TestClient(url).recover(words), 404);
    });

    it('the recovery key can delete a family whose phones are lost', async () => {
      const { a, words } = await fullFamily();
      const recovery = recoveryIdentity(words);
      const rescuer = new TestClient(url);
      await rescuer.login(recovery, { recoverySignKey: toBase64(recovery.sign.publicKey) });
      await rescuer.request('DELETE', '/v1/families/me');
      expect(await leftovers(a.familyId)).toEqual({});
    });

    it('is deleted when its last phone leaves, recovery key and all', async () => {
      const { a, b, ref } = await fullFamily();
      await b.refresh();
      await b.append({ type: 'remove', deviceId: b.deviceId });
      expect(await leftovers(a.familyId)).toHaveProperty('records');
      await a.refresh();
      await a.append({ type: 'remove', deviceId: a.deviceId });
      expect(await leftovers(a.familyId)).toEqual({});
      expect(storedFile(ref.id)).toBe(false);
    });

    it('needs a login, and only deletes the caller\'s own family', async () => {
      const { a } = await pairedFamily();
      const other = await pairedFamily();
      await expectStatus(new TestClient(url).request('DELETE', '/v1/families/me'), 401);
      await other.a.request('DELETE', '/v1/families/me');
      expect(await leftovers(a.familyId)).toMatchObject({ families: 1, devices: 2 });
      expect(await leftovers(other.a.familyId)).toEqual({});
    });
  });

  describe('payments (hosted)', () => {
    let hosted: Awaited<ReturnType<typeof createApp>>;
    let base = '';
    let play: Server;
    const apple = appleTestSigner();
    /** The fake Play API's purchases by token, and what was acknowledged or consumed. */
    const playPurchases = new Map<string, { product: string; purchaseState: number; obfuscatedExternalAccountId?: string; consumptionState: number; acknowledgementState: number }>();
    const voided: string[] = [];

    beforeAll(async () => {
      play = createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          const send = (status: number, body: unknown = {}) => {
            res.statusCode = status;
            res.end(JSON.stringify(body));
          };
          if (req.url === '/token') {
            const claims = new URLSearchParams(raw).get('assertion')!.split('.')[1]!;
            const { scope } = JSON.parse(Buffer.from(claims, 'base64url').toString()) as { scope: string };
            return send(scope.includes('androidpublisher') ? 200 : 401, { access_token: 'play-access', expires_in: 3600 });
          }
          if (req.headers.authorization !== 'Bearer play-access') return send(401);
          const path = decodeURIComponent(req.url!.split('?')[0]!);
          if (path === '/play/applications/baby.subby.app/purchases/voidedpurchases') {
            return send(200, { voidedPurchases: voided.map((purchaseToken) => ({ purchaseToken })) });
          }
          const m = /^\/play\/applications\/baby\.subby\.app\/purchases\/products\/([^/]+)\/tokens\/([^/:]+)(:consume|:acknowledge)?$/.exec(path);
          const purchase = m && playPurchases.get(m[2]!);
          if (!m || !purchase || purchase.product !== m[1]) return send(404);
          if (m[3] === ':consume') purchase.consumptionState = 1;
          if (m[3] === ':acknowledge') purchase.acknowledgementState = 1;
          send(200, m[3] ? {} : purchase);
        });
      });
      await new Promise<void>((resolve) => play.listen(0, '127.0.0.1', resolve));
      const playUrl = `http://127.0.0.1:${(play.address() as { port: number }).port}`;
      hosted = await createApp({
        databaseUrl: ADMIN_URL.replace(/\/[^/]+$/, `/${dbName}`),
        port: 0,
        mode: 'hosted',
        migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
        blobs: { kind: 'disk', dir: blobDir },
        push: { kind: 'none' },
        rateLimit: false,
        trustProxy: false,
        stores: {
          google: { clientEmail: 'play@subby-test.iam.gserviceaccount.com', privateKey: fcmKey.privateKey, tokenUri: `${playUrl}/token`, packageName: 'baby.subby.app', apiUrl: `${playUrl}/play` },
          apple: { bundleId: 'baby.subby.app', roots: [apple.rootPem], allowSandbox: false },
          test: true,
        },
      });
      await hosted.listen({ port: 0, host: '127.0.0.1' });
      base = (await hosted.getUrl()).replace('[::1]', '127.0.0.1');
    });

    afterAll(async () => {
      await hosted?.close();
      play?.close();
    });

    const entitlement = (c: TestClient) => c.request<EntitlementResponse>('GET', '/v1/entitlement');
    const buy = (c: TestClient, store: 'google' | 'apple' | 'test', product: string, token: string) => c.request<EntitlementResponse>('POST', '/v1/purchases', { store, product, token });
    const googlePurchase = (c: TestClient, product: string, state = 0) => {
      const token = `token-${randomUUID()}`;
      playPurchases.set(token, { product, purchaseState: state, obfuscatedExternalAccountId: c.deviceId, consumptionState: 0, acknowledgementState: 0 });
      return token;
    };
    const appleTransaction = (c: TestClient, product: string, over: object = {}) =>
      apple.sign({ originalTransactionId: String(Math.floor(Math.random() * 1e12)), bundleId: 'baby.subby.app', productId: product, environment: 'Production', appAccountToken: c.deviceId, ...over });
    /** Moves the family's start (and its phones' joining, keeping their order) `days` back. */
    const ageFamily = async (c: TestClient, days: number) => {
      const [{ created }] = await db`select extract(epoch from now() - created_at) * 1000 as created from families where id = ${c.familyId}`;
      const shift = days * 86_400_000 - Number(created);
      await db`update families set created_at = created_at - make_interval(secs => ${shift / 1000}) where id = ${c.familyId}`;
      await db`update devices set added_at = added_at - make_interval(secs => ${shift / 1000}) where family_id = ${c.familyId}`;
    };
    const write = (c: TestClient) => c.push([c.seal('child', randomUUID(), { name: 'Sam' })]);

    it('a self-hosted server is free: nothing to buy', async () => {
      const { a } = await pairedFamily();
      expect(await entitlement(a)).toMatchObject({ access: 'free', trialEndsAt: null, photoLimit: null });
      await expectStatus(buy(a, 'google', 'sync_unlock', 'x'), 400);
    });

    it('a new family syncs for 14 days, then 48 hours of grace, then only pulls', async () => {
      const { a, b } = await pairedFamily(base);
      const trial = await entitlement(a);
      expect(trial.access).toBe('trial');
      expect(trial.trialEndsAt! - Date.now()).toBeGreaterThan(13.9 * 86_400_000);
      expect(trial.photoLimit).toBe(2 * 1024 ** 3);
      await write(a);

      await ageFamily(a, 15);
      expect((await entitlement(a)).access).toBe('grace');
      await write(a);

      await ageFamily(a, 17);
      expect((await entitlement(a)).access).toBe('readOnly');
      await expectStatus(write(a), 402);
      await expectStatus(a.uploadFile(new Uint8Array([1, 2, 3])), 402);
      // Pulling, and managing the family, still work.
      await b.pull();
      await a.refresh();
    });

    it('a phone without an unlock may still tell its family it moved, and nothing else', async () => {
      const { a } = await pairedFamily(base);
      await ageFamily(a, 30);
      const moved = () => a.seal('moved', randomUUID(), { server: 'https://sync.example.com', familyId: randomUUID(), from: a.deviceId, seq: a.lastSeq });
      await expectStatus(a.push([a.seal('log', randomUUID(), { note: 'x' })]), 402);
      await a.push([moved()]);
      await expectStatus(a.push([moved(), a.seal('log', randomUUID(), { note: 'x' })]), 402);
    });

    it('a phone that joins after the trial gets its own 48 hours', async () => {
      const a = new TestClient(base);
      await a.createFamily();
      await ageFamily(a, 30);
      const { qr, secret } = await a.invite();
      const late = new TestClient(base);
      await late.claim(qr);
      await (await a.reviewClaim(qr.i, secret)).approve();
      await late.finishJoin(qr);
      expect((await entitlement(late)).access).toBe('grace');
      expect((await entitlement(a)).access).toBe('readOnly');
    });

    it('an own unlock from Google Play, acknowledged, and moved to a new phone by a restore', async () => {
      const { a } = await pairedFamily(base);
      await ageFamily(a, 30);
      const token = googlePurchase(a, 'sync_unlock');
      expect((await buy(a, 'google', 'sync_unlock', token)).access).toBe('unlock');
      expect(playPurchases.get(token)!.acknowledgementState).toBe(1);
      await write(a);
      // Sending it again changes nothing.
      expect((await buy(a, 'google', 'sync_unlock', token)).access).toBe('unlock');

      // The same store account on a new phone, in another family: the unlock moves there.
      const other = await pairedFamily(base);
      await ageFamily(other.a, 30);
      expect((await buy(other.a, 'google', 'sync_unlock', token)).access).toBe('unlock');
      expect((await entitlement(a)).access).toBe('readOnly');
    });

    it('gifted slots go to the phones without an unlock, in the order they joined', async () => {
      const { a, b } = await pairedFamily(base);
      await ageFamily(a, 30);
      const unlock = googlePurchase(a, 'sync_unlock');
      await buy(a, 'google', 'sync_unlock', unlock);
      const slot = googlePurchase(a, 'sync_slot');
      const after = await buy(a, 'google', 'sync_slot', slot);
      expect(playPurchases.get(slot)!.consumptionState).toBe(1);
      expect(after).toMatchObject({ access: 'unlock', slots: 1, freeSlots: 0 });
      expect(after.devices).toEqual([
        { id: a.deviceId, access: 'unlock' },
        { id: b.deviceId, access: 'slot' },
      ]);
      await write(b);

      // Removing b frees its slot.
      await a.removeDevice(b.deviceId);
      expect(await entitlement(a)).toMatchObject({ slots: 1, freeSlots: 1 });

      // A slot is for the buyer's own family, once.
      const other = await pairedFamily(base);
      await expectStatus(buy(other.a, 'google', 'sync_slot', slot), 403);
      // Without an account id in the purchase, a slot already given to a family can't be given to another.
      const unmarked = googlePurchase(a, 'sync_slot');
      delete playPurchases.get(unmarked)!.obfuscatedExternalAccountId;
      await buy(other.a, 'google', 'sync_slot', unmarked);
      await expectStatus(buy(a, 'google', 'sync_slot', unmarked), 409);
    });

    it('refuses pending, cancelled and unknown purchases, and products sent as the wrong kind', async () => {
      const { a } = await pairedFamily(base);
      await expectStatus(buy(a, 'google', 'sync_unlock', googlePurchase(a, 'sync_unlock', 2)), 409);
      await expectStatus(buy(a, 'google', 'sync_unlock', googlePurchase(a, 'sync_unlock', 1)), 403);
      await expectStatus(buy(a, 'google', 'sync_unlock', 'nobody-knows'), 403);
      await expectStatus(buy(a, 'google', 'sync_slot', googlePurchase(a, 'sync_unlock')), 403);
      await expectStatus(buy(a, 'google', 'sync_other', 'x'), 400);
    });

    it('a Google refund takes the unlock away (checked hourly)', async () => {
      const { a } = await pairedFamily(base);
      await ageFamily(a, 30);
      const token = googlePurchase(a, 'sync_unlock');
      await buy(a, 'google', 'sync_unlock', token);
      voided.push(token);
      expect(await hosted.get(Housekeeping).run()).toMatchObject({ refunds: 1 });
      expect((await entitlement(a)).access).toBe('readOnly');
      await expectStatus(buy(a, 'google', 'sync_unlock', token), 403);
      voided.length = 0;
    });

    it('App Store purchases are checked by their signature; refunds arrive as notifications', async () => {
      const { a, b } = await pairedFamily(base);
      await ageFamily(a, 30);
      const unlock = appleTransaction(a, 'sync_unlock');
      expect((await buy(a, 'apple', 'sync_unlock', unlock)).access).toBe('unlock');
      const slot = appleTransaction(a, 'sync_slot');
      expect(await buy(a, 'apple', 'sync_slot', slot)).toMatchObject({ slots: 1 });
      expect((await entitlement(b)).access).toBe('slot');

      await expectStatus(buy(a, 'apple', 'sync_unlock', appleTransaction(a, 'sync_unlock', { environment: 'Sandbox' })), 403);
      await expectStatus(buy(a, 'apple', 'sync_unlock', appleTransaction(a, 'sync_unlock', { bundleId: 'com.other' })), 403);
      await expectStatus(buy(a, 'apple', 'sync_unlock', appleTestSigner().sign({})), 403);

      const id = (jws: string) => JSON.parse(Buffer.from(jws.split('.')[1]!, 'base64url').toString()) as { originalTransactionId: string };
      const notify = (type: string, transaction: string) =>
        fetch(`${base}/v1/purchases/apple/notifications`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ signedPayload: apple.sign({ notificationType: type, data: { signedTransactionInfo: transaction } }) }),
        });
      expect((await notify('REFUND', slot)).status).toBe(200);
      expect((await entitlement(b)).access).toBe('readOnly');
      expect((await notify('REFUND_REVERSED', slot)).status).toBe(200);
      expect((await entitlement(b)).access).toBe('slot');
      expect(id(unlock).originalTransactionId).toBeTruthy();
      // Unsigned or foreign notifications are refused.
      const forged = await fetch(`${base}/v1/purchases/apple/notifications`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signedPayload: appleTestSigner().sign({ notificationType: 'REFUND', data: { signedTransactionInfo: unlock } }) }),
      });
      expect(forged.status).toBe(400);
      expect((await entitlement(a)).access).toBe('unlock');
    });

    it('the test store unlocks without a payment, only where the server allows it', async () => {
      const info = async (server: string) => ((await (await fetch(`${server}/v1/info`)).json()) as { testPurchases: boolean }).testPurchases;
      expect(await info(base)).toBe(true);
      expect(await info(url)).toBe(false);
      const { a, b } = await pairedFamily(base);
      await ageFamily(a, 30);
      const token = `test-${randomUUID()}`;
      expect((await buy(a, 'test', 'sync_unlock', token)).access).toBe('unlock');
      expect((await buy(a, 'test', 'sync_slot', `test-${randomUUID()}`)).devices.map((d) => d.access)).toEqual(['unlock', 'slot']);
      await expectStatus(buy(a, 'test', 'sync_unlock', 'made-up'), 403);
      const refunded = await a.request<EntitlementResponse>('POST', '/v1/purchases/test/refund', { token });
      expect(refunded.access).toBe('slot'); // the slot now goes to a, the first phone without an unlock
      expect((await entitlement(b)).access).toBe('readOnly');
    });

    it('the admin command grants slots without a payment, and takes them back', async () => {
      const { a, b } = await pairedFamily(base);
      await ageFamily(a, 30);
      const lines: string[] = [];
      const admin = (...args: string[]) => runAdmin(hosted.get(DB), hosted.get(Entitlements), args, (l) => lines.push(l));
      await admin('grant-slots', a.familyId, '2');
      expect((await entitlement(a)).devices.map((d) => d.access)).toEqual(['slot', 'slot']);
      await write(b);
      await admin('status', a.familyId);
      expect(lines.join('\n')).toContain('Slots: 2 (0 unused)');
      await admin('revoke-grants', a.familyId);
      expect(lines.at(-1)).toBe('Revoked 2 granted slots.');
      expect((await entitlement(a)).access).toBe('readOnly');
      await expect(admin('grant-slots', randomUUID())).rejects.toThrow(AdminError);
      await expect(admin('grant-slots', a.familyId, '0')).rejects.toThrow(AdminError);
      await expect(admin('nonsense')).rejects.toThrow(AdminError);
    });

    it('stops photo uploads at 2 GB per family', async () => {
      const { a } = await pairedFamily(base);
      await db`insert into blobs (id, family_id, size, created_at) values (${randomUUID()}, ${a.familyId}, ${2 * 1024 ** 3 - 10}, ${Date.now()})`;
      await expectStatus(a.uploadFile(new Uint8Array(100)), 403);
      expect((await entitlement(a)).photoBytes).toBe(2 * 1024 ** 3 - 10);
    });
  });

  describe('rate limits', () => {
    it('answers 429 past the limit, per client IP as told by a trusted proxy', async () => {
      const limited = await createApp({
        databaseUrl: ADMIN_URL.replace(/\/[^/]+$/, `/${dbName}`),
        port: 0,
        mode: 'self',
        migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
        blobs: { kind: 'disk', dir: blobDir },
        push: { kind: 'none' },
        rateLimit: true,
        trustProxy: 'loopback',
        stores: { google: null, apple: null, test: false },
      });
      try {
        await limited.listen({ port: 0, host: '127.0.0.1' });
        const base = (await limited.getUrl()).replace('[::1]', '127.0.0.1');
        const challenge = (ip: string) =>
          fetch(`${base}/v1/auth/challenge`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: '{}' });
        for (let i = 0; i < 30; i++) expect((await challenge('203.0.113.1')).status).toBe(400);
        const refused = await challenge('203.0.113.1');
        expect(refused.status).toBe(429);
        expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
        // Another client behind the same proxy isn't affected.
        expect((await challenge('203.0.113.2')).status).toBe(400);
        // Other routes have their own budget.
        expect((await fetch(`${base}/v1/info`, { headers: { 'x-forwarded-for': '203.0.113.1' } })).status).toBe(200);
      } finally {
        await limited.close();
      }
    });
  });
});
