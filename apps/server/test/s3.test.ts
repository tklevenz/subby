// The S3 blob store against a real S3-compatible server that checks signatures. Opt-in, like the e2e suite needs
// Postgres. With SeaweedFS (MinIO's images are no longer public), credentials minioadmin/minioadmin:
//   echo '{"identities":[{"name":"t","credentials":[{"accessKey":"minioadmin","secretKey":"minioadmin"}],"actions":["Admin","Read","Write","List"]}]}' > /tmp/s3.json
//   docker run -d --rm -p 9000:8333 -v /tmp/s3.json:/etc/s3.json:ro --name subby-s3 chrislusf/seaweedfs server -s3 -s3.config=/etc/s3.json
//   echo 's3.bucket.create -name subby-test' | docker exec -i subby-s3 weed shell
//   S3_TEST_ENDPOINT=http://127.0.0.1:9000 npx vitest run s3
// S3_TEST_BUCKET, _REGION, _ACCESS_KEY_ID and _SECRET_ACCESS_KEY point it elsewhere.
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openBlobStore } from '../src/blobs/store';

const endpoint = process.env.S3_TEST_ENDPOINT;
const config = {
  kind: 's3' as const,
  bucket: process.env.S3_TEST_BUCKET ?? 'subby-test',
  region: process.env.S3_TEST_REGION ?? 'us-east-1',
  endpoint,
  accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? 'minioadmin',
  secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? 'minioadmin',
};

async function read(body: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

describe.skipIf(!endpoint)('S3 blob store', () => {
  const store = openBlobStore(config);

  it('stores, streams back and deletes a blob', async () => {
    await store.check();
    const id = randomUUID();
    const data = randomBytes(3 * 1024 * 1024 + 7);
    await store.put(id, data);
    const got = await store.get(id);
    expect(got?.size).toBe(data.length);
    expect((await read(got!.body)).equals(data)).toBe(true);
    await store.delete(id);
    expect(await store.get(id)).toBeNull();
    await store.delete(id); // a missing one is not an error
  });

  it('fails the check for a missing bucket or wrong credentials', async () => {
    await expect(openBlobStore({ ...config, bucket: `missing-${randomUUID()}` }).check()).rejects.toThrow(/404/);
    await expect(openBlobStore({ ...config, secretAccessKey: 'wrong' }).check()).rejects.toThrow(/403/);
    await expect(openBlobStore({ ...config, secretAccessKey: 'wrong' }).put(randomUUID(), randomBytes(10))).rejects.toThrow(/403/);
  });
});
