import { access, constants, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';
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

type S3Sdk = typeof import('@aws-sdk/client-s3');

/**
 * Any S3-compatible object storage (AWS, Hetzner, MinIO, R2…). The AWS SDK is loaded only here, so a server storing
 * photos on disk never pays its memory (tens of MB).
 */
class S3Store implements BlobStore {
  private readonly client: Promise<{ sdk: S3Sdk; s3: S3Client }>;
  private readonly bucket: string;

  constructor(config: Extract<BlobStoreConfig, { kind: 's3' }>) {
    this.bucket = config.bucket;
    this.client = import('@aws-sdk/client-s3').then((sdk) => ({ sdk, s3: S3Store.connect(sdk, config) }));
    // Failing to load surfaces on first use (and /healthz); don't leave the rejection unhandled meanwhile.
    void this.client.catch(() => undefined);
  }

  private static connect(sdk: S3Sdk, config: Extract<BlobStoreConfig, { kind: 's3' }>) {
    return new sdk.S3Client({
      region: config.region,
      endpoint: config.endpoint,
      // Most non-AWS providers want bucket-in-path URLs.
      forcePathStyle: Boolean(config.endpoint),
      credentials:
        config.accessKeyId && config.secretAccessKey ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } : undefined,
    });
  }

  async put(id: string, data: Uint8Array) {
    const { sdk, s3 } = await this.client;
    await s3.send(new sdk.PutObjectCommand({ Bucket: this.bucket, Key: id, Body: data, ContentType: 'application/octet-stream' }));
  }

  async get(id: string): Promise<StoredBlob | null> {
    const { sdk, s3 } = await this.client;
    try {
      const res = await s3.send(new sdk.GetObjectCommand({ Bucket: this.bucket, Key: id }));
      if (!res.Body) return null;
      // In Node, the SDK's body is a Readable (the HTTP response).
      const body = res.Body instanceof Readable ? res.Body : Readable.from([await res.Body.transformToByteArray()]);
      return { body, size: res.ContentLength };
    } catch (e) {
      if (e instanceof sdk.NoSuchKey) return null;
      throw e;
    }
  }

  async delete(id: string) {
    const { sdk, s3 } = await this.client;
    await s3.send(new sdk.DeleteObjectCommand({ Bucket: this.bucket, Key: id }));
  }

  async check() {
    const { sdk, s3 } = await this.client;
    await s3.send(new sdk.HeadBucketCommand({ Bucket: this.bucket }));
  }
}
