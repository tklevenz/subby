/**
 * Smoke test against a running server, e.g. after a deploy:
 *   pnpm --filter @subby/server smoke https://sync.subby.baby
 * A throwaway family: create, upload an encrypted photo, push and pull a record, then delete it all again.
 */
import { randomUUID } from 'node:crypto';
import { TestClient } from './client';

const server = process.argv[2];
if (!server) throw new Error('Usage: smoke <server url>');

const phone = new TestClient(server.replace(/\/+$/, ''));
await phone.createFamily();
try {
  const photo = new Uint8Array(64 * 1024).map((_, i) => i % 251);
  const ref = await phone.uploadFile(photo);
  const id = randomUUID();
  await phone.push([phone.seal('log', id, { smoke: true, photoBlob: ref }, { blobs: [ref.id] })]);
  const pulled = await phone.pull();
  if (!pulled.some((p) => p.record.id === id)) throw new Error('The record did not come back');
  const back = await phone.downloadFile(ref);
  if (back.length !== photo.length || back.some((b, i) => b !== photo[i])) throw new Error('The photo came back different');
  console.log(`✓ ${server}: family, photo upload/download and sync work`);
} finally {
  await phone.request('DELETE', '/v1/families/me');
  console.log('✓ Throwaway family deleted');
}
