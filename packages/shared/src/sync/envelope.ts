import { bytesToJson, fromBase64, jsonToBytes, toBase64, utf8ToBytes } from '../crypto/bytes';
import { decrypt, encrypt } from '../crypto/aead';

/**
 * What the server stores per record. It sees the id, kind, key epoch, version and size, never the content.
 * `child` and `log` are app rows; `device` holds a device's display name (names stay off the device log).
 */
export const RECORD_KINDS = ['child', 'log', 'device'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export type SyncRecord = {
  id: string;
  kind: RecordKind;
  /** Family key epoch the data is encrypted with. */
  epoch: number;
  /** Last-writer-wins version: edit time, ties broken by the writing device. */
  updatedAt: number;
  deviceId: string;
  deleted: boolean;
  /** base64url(nonce || ciphertext); null for tombstones, so deleted data is gone from the server too. */
  data: string | null;
  /**
   * Encrypted files (photos) this version uses, by random blob id. Only a hint for the server's cleanup:
   * blobs a record stops listing are deleted. Left out, the record's blobs stay as they were. Not part of
   * the AAD; the reference that matters (id + key) is inside the ciphertext.
   */
  blobs?: string[];
};

export type RecordMeta = Omit<SyncRecord, 'data' | 'epoch'>;

/** Family keys by epoch. A device keeps every epoch it was given so older records stay readable. */
export type FamilyKeys = ReadonlyMap<number, Uint8Array>;

// The metadata is authenticated with the ciphertext, so the server can't move data between records,
// replay it under another version or resurrect a tombstone with old content.
const aad = (m: RecordMeta, epoch: number) =>
  utf8ToBytes(JSON.stringify(['kindred/record/v1', m.id, m.kind, epoch, m.updatedAt, m.deviceId, m.deleted]));

export function sealRecord(key: Uint8Array, epoch: number, meta: RecordMeta, body: unknown): SyncRecord {
  if (meta.deleted) return { ...meta, epoch, data: null };
  return { ...meta, epoch, data: toBase64(encrypt(key, jsonToBytes(body), aad(meta, epoch))) };
}

/** The decrypted body, or null for a tombstone. Throws if the key for its epoch is missing or the data was altered. */
export function openRecord<T>(keys: FamilyKeys, record: SyncRecord): T | null {
  if (record.deleted) return null;
  if (record.data === null) throw new Error(`Record ${record.id} has no data`);
  const key = keys.get(record.epoch);
  if (!key) throw new Error(`No family key for epoch ${record.epoch}`);
  const { data, epoch, ...meta } = record;
  return bytesToJson<T>(decrypt(key, fromBase64(data), aad(meta, epoch)));
}
