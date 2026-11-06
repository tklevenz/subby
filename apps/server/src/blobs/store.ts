import { access, constants, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { BlobStoreConfig } from '../config';

/** Where encrypted files live. Ids are UUIDs checked by the caller, so they are safe as file names and keys. */
export interface BlobStore {
  put(id: string, data: Uint8Array): Promise<void>;
  /** null when the blob doesn't exist. */
  get(id: string): Promise<Uint8Array | null>;
  /** Deleting a missing blob is not an error. */
  delete(id: string): Promise<void>;
  /** Throws when the store can't be used (for /healthz): the folder isn't writable, or the bucket can't be reached. */
  check(): Promise<void>;
}

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

  async get(id: string) {
    try {
      return await readFile(this.path(id)); // a Buffer is a Uint8Array; no copy
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

/** Any S3-compatible object storage (AWS, Hetzner, MinIO, R2…). */
class S3Store implements BlobStore {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(config: Extract<BlobStoreConfig, { kind: 's3' }>) {
    this.bucket = config.bucket;
    this.s3 = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      // Most non-AWS providers want bucket-in-path URLs.
      forcePathStyle: Boolean(config.endpoint),
      credentials:
        config.accessKeyId && config.secretAccessKey ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } : undefined,
    });
  }

  async put(id: string, data: Uint8Array) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: id, Body: data, ContentType: 'application/octet-stream' }));
  }

  async get(id: string) {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: id }));
      return res.Body ? await res.Body.transformToByteArray() : null;
    } catch (e) {
      if (e instanceof NoSuchKey) return null;
      throw e;
    }
  }

  async delete(id: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: id }));
  }

  async check() {
    await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
