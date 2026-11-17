import { access, constants, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { AwsClient } from 'aws4fetch';
import type { BlobStoreConfig } from '../config';

/** Where encrypted files live. Ids are UUIDs checked by the caller, so they are safe as file names and keys. */
export interface BlobStore {
  put(id: string, data: Uint8Array): Promise<void>;
  /**
   * A stream of the stored file and its size, or null when the blob doesn't exist. Streamed: photos are up to
   * 20 MB, and a client reading slowly must not keep a whole one in memory.
   */
  get(id: string): Promise<StoredBlob | null>;
  /** Deleting a missing blob is not an error. */
  delete(id: string): Promise<void>;
  /** Throws when the store can't be used (for /healthz): the folder isn't writable, or the bucket can't be reached. */
  check(): Promise<void>;
}

export type StoredBlob = { body: Readable; size: number | undefined };

export const BLOB_STORE = Symbol('BLOB_STORE');

export function openBlobStore(config: BlobStoreConfig): BlobStore {
  return config.kind === 'disk' ? new DiskStore(resolve(config.dir)) : new S3Store(config);
}

/** A local folder, two levels of fan-out (ab/cd/abcd…) so no directory gets huge. */
class DiskStore implements BlobStore {
  constructor(private readonly root: string) {}

  private path(id: string) {
    return join(this.root, id.slice(0, 2), id.slice(2, 4), id);
  }

  async put(id: string, data: Uint8Array) {
    const path = this.path(id);
    await mkdir(dirname(path), { recursive: true });
    // Write then rename, so a crash never leaves a half-written blob under its real name.
    const tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, path);
  }

  async get(id: string): Promise<StoredBlob | null> {
    try {
      const file = await open(this.path(id));
      try {
        return { body: file.createReadStream(), size: (await file.stat()).size };
      } catch (e) {
        await file.close();
        throw e;
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async delete(id: string) {
    await rm(this.path(id), { force: true });
  }

  async check() {
    await mkdir(this.root, { recursive: true });
    await access(this.root, constants.W_OK);
  }
}

/**
 * Any S3-compatible object storage (AWS, Hetzner, MinIO, R2…), spoken to directly with SigV4-signed fetches
 * (aws4fetch: one small file, no dependencies, reviewed at 1.0.20) instead of the AWS SDK's ~30 packages and
 * tens of MB. Only four calls are needed: put, get, delete, and a bucket check.
 */
class S3Store implements BlobStore {
  private readonly aws: AwsClient;
  private readonly base: string;

  constructor(config: Extract<BlobStoreConfig, { kind: 's3' }>) {
    this.aws = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      sessionToken: config.sessionToken,
      service: 's3',
      region: config.region,
      // Its default is 10 retries (up to ~100 s of backoff); a request should fail well within the app's patience.
      retries: 3,
      initRetryMs: 100,
    });
    // Most non-AWS providers want bucket-in-path URLs; AWS itself takes the bucket as a subdomain.
    this.base = config.endpoint
      ? `${config.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(config.bucket)}`
      : `https://${config.bucket}.s3.${config.region}.amazonaws.com`;
  }

  /** Throws on anything but `ok` (and the listed statuses), with the status only: S3's error bodies aren't logged. */
  private async request(method: string, id: string | null, init: { body?: Uint8Array; headers?: Record<string, string> } = {}, allow: number[] = []) {
    const url = id === null ? this.base : `${this.base}/${id}`;
    // Covers getting the response headers; a streamed body is paced by the client reading it, not by this.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), S3_TIMEOUT_MS);
    try {
      const res = await this.aws.fetch(url, { method, body: init.body as Uint8Array<ArrayBuffer> | undefined, headers: init.headers, signal: abort.signal });
      if (!res.ok && !allow.includes(res.status)) {
        await res.body?.cancel();
        throw new Error(`S3 ${method} failed: ${res.status}`);
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async put(id: string, data: Uint8Array) {
    const res = await this.request('PUT', id, { body: data, headers: { 'Content-Type': 'application/octet-stream' } });
    await res.body?.cancel();
  }

  async get(id: string): Promise<StoredBlob | null> {
    const res = await this.request('GET', id, {}, [404]);
    if (res.status === 404 || !res.body) {
      await res.body?.cancel();
      return null;
    }
    const length = res.headers.get('content-length');
    return { body: Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), size: length === null ? undefined : Number(length) };
  }

  async delete(id: string) {
    // S3 answers 204 whether or not the object existed; some compatible stores answer 404 for a missing one.
    const res = await this.request('DELETE', id, {}, [404]);
    await res.body?.cancel();
  }

  async check() {
    await this.request('HEAD', null);
  }
}

const S3_TIMEOUT_MS = 60_000;
