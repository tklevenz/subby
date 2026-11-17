import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';

const dir = mkdtempSync(join(tmpdir(), 'subby-config-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const file = (name: string, text: string) => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};
const load = (env: Record<string, string>) => loadConfig({ DATABASE_URL: 'postgres://x', ...env }, 'drizzle');
const p8 = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('push keys', () => {
  it('loads a good APNs key', () => {
    const config = load({ APNS_KEY: file('good.p8', p8), APNS_KEY_ID: 'KEY1234567', APNS_TEAM_ID: 'TEAM123456' });
    expect(config.apns).toMatchObject({ keyId: 'KEY1234567', teamId: 'TEAM123456', topic: 'baby.subby.app' });
  });

  it("starts without the push a broken key is for, instead of crashing", () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const flattened = p8.replace(/\n/g, ' '); // pasted into an editor, line breaks lost
    expect(load({ APNS_KEY: file('bad.p8', flattened), APNS_KEY_ID: 'KEY1234567', APNS_TEAM_ID: 'TEAM123456' }).apns).toBeNull();
    expect(load({ APNS_KEY: join(dir, 'missing.p8'), APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T' }).apns).toBeNull();
    expect(load({ APNS_KEY: file('ok.p8', p8) }).apns).toBeNull(); // no key id or team id
    expect(load({ PUSH: 'fcm', FCM_SERVICE_ACCOUNT: file('firebase.json', '{"project_id":"x"}') }).push).toEqual({ kind: 'none' });
    expect(error.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringMatching(/^iOS push \(APNS_KEY\) is off: .*bad\.p8 isn't a usable \.p8 key/),
      expect.stringMatching(/^iOS push \(APNS_KEY\) is off: .*ENOENT/),
      expect.stringMatching(/^iOS push \(APNS_KEY\) is off: APNS_KEY_ID and APNS_TEAM_ID are required/),
      expect.stringMatching(/^Android push \(PUSH=fcm\) is off: .*isn't a service-account key/),
    ]);
    error.mockRestore();
  });
});

describe('S3 blob store', () => {
  it('needs credentials, from S3_* or AWS_*', () => {
    expect(() => load({ BLOB_STORE: 's3', S3_BUCKET: 'b' })).toThrow(/S3_ACCESS_KEY_ID/);
    expect(() => load({ BLOB_STORE: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: '' })).toThrow(/S3_SECRET_ACCESS_KEY/);
    expect(load({ BLOB_STORE: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', S3_ENDPOINT: '' }).blobs).toEqual({
      kind: 's3', bucket: 'b', region: 'us-east-1', endpoint: undefined, accessKeyId: 'k', secretAccessKey: 's', sessionToken: undefined,
    });
    expect(load({ BLOB_STORE: 's3', S3_BUCKET: 'b', AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 's', AWS_SESSION_TOKEN: 't', AWS_REGION: 'eu-central-1' }).blobs).toMatchObject({
      accessKeyId: 'a', sessionToken: 't', region: 'eu-central-1',
    });
  });
});
