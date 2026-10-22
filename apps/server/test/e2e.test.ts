import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newRecoveryWords, toBase64 } from '@kindred-log/shared/crypto';
import { createApp } from '../src/app';
import { HttpError, TestClient } from './client';

/**
 * End-to-end: the real server on a throwaway Postgres database, driven by simulated apps.
 * Needs the dev database: `pnpm --filter @kindred-log/server db:up`. Skipped (loudly) when it isn't running.
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://kindred:kindred@localhost:54329/kindred';
const dbName = `kl_test_${randomUUID().replace(/-/g, '')}`;
const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {}, connect_timeout: 3 });
const reachable = await admin`select 1`.then(
  () => true,
  () => false,
);
if (!reachable) console.warn('\n⚠ Server e2e tests SKIPPED: no Postgres. Run `pnpm --filter @kindred-log/server db:up`.\n');

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

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    const dbUrl = ADMIN_URL.replace(/\/[^/]+$/, `/${dbName}`);
    db = postgres(dbUrl, { max: 1, onnotice: () => {} });
    app = await createApp({
      databaseUrl: dbUrl,
      port: 0,
      mode: 'self',
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    url = await app.getUrl();
    url = url.replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
    await db?.end();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  /** A family with two paired phones, as most tests need. */
  async function pairedFamily() {
    const a = new TestClient(url);
    await a.createFamily();
    const b = new TestClient(url);
    const { qr, secret } = await a.invite();
    const codeB = await b.claim(qr);
    const { code: codeA, approve } = await a.reviewClaim(qr.i, secret);
    expect(codeA).toBe(codeB);
    expect(await b.finishJoin(qr)).toBe(false);
    await approve();
    expect(await b.finishJoin(qr)).toBe(true);
    return { a, b };
  }

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
  });

  it('keeps the newest version and reports stale pushes', async () => {
    const { a, b } = await pairedFamily();
    const id = randomUUID();
    await a.push([a.seal('log', id, { v: 'old' }, { updatedAt: 1000 })]);
    const newer = await b.push([b.seal('log', id, { v: 'new' }, { updatedAt: 2000 })]);
    expect(newer.accepted).toEqual([id]);
    const older = await a.push([a.seal('log', id, { v: 'older' }, { updatedAt: 1500 })]);
    expect(older.stale).toEqual([id]);
    const pulled = await a.pull();
    expect(pulled.filter((p) => p.record.id === id).at(-1)!.body).toEqual({ v: 'new' });
  });

  it('deletes data on the server: tombstones carry nothing', async () => {
    const a = new TestClient(url);
    await a.createFamily();
    const id = randomUUID();
    await a.push([a.seal('log', id, { secret: 'note text' })]);
    await a.push([a.seal('log', id, null, { deleted: true })]);
    const [row] = await db`select data, deleted from records where id = ${id}`;
    expect(row).toEqual({ data: null, deleted: true });
  });

  it('pages through long histories', async () => {
    const a = new TestClient(url);
    await a.createFamily();
    const records = Array.from({ length: 450 }, (_, i) => a.seal('log', randomUUID(), { i }));
    await a.push(records);
    const b = new TestClient(url);
    Object.assign(b, { deviceId: a.deviceId, identity: a.identity, token: a.token, familyKeys: a.familyKeys });
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
    // The server refuses a rotation that leaves out or adds anyone.
    await expectStatus(a.request('POST', '/v1/keys/rotate', { epoch: 3, sealed: {} }), 400);
  });

  it('rejects device log entries that are forged or out of order', async () => {
    const a = new TestClient(url);
    await a.createFamily();
    const outsider = new TestClient(url);
    const { appendEntry } = await import('@kindred-log/shared/crypto');
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
    const { recoveryIdentity } = await import('@kindred-log/shared/crypto');
    const id = recoveryIdentity(words);
    await rec.login(id, { recoverySignKey: toBase64(id.sign.publicKey) });
    await expectStatus(rec.request('GET', '/v1/sync/pull'), 403);
    await expectStatus(rec.request('POST', '/v1/keys/rotate', { epoch: 2, sealed: {} }), 403);
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
});
