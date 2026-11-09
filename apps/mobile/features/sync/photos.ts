import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Child, LogEntry, PhotoBlob } from '@subby/shared';
import { decryptFile, encryptFile, encryptedFileSize, fromBase64, newSymmetricKey, toBase64 } from '@subby/shared/crypto';
import { MAX_BLOB_BYTES } from '@subby/shared/sync';
import { db, schema } from '../../db/client';
import { deletePhoto, photoSize, readPhotoBytes, savePhotoBytes } from '../photos';
import { SyncHttpError, type SyncSession } from './api';
import { needsPhotoUpload } from './records';

/**
 * Photo references point at blobs on one server, for one family. A phone starting or joining another family
 * (a new server, or setting sync up again) forgets them, so its photos upload to the new family. With
 * `onlyLocal`, only rows whose photo file is on this phone are touched (they're the ones it can re-upload).
 */
export async function forgetPhotoUploads({ onlyLocal = false } = {}) {
  await db
    .update(schema.childrenTable)
    .set({ photoBlob: null })
    .where(onlyLocal ? isNotNull(schema.childrenTable.photoUri) : isNotNull(schema.childrenTable.photoBlob));
  await db
    .update(schema.logsTable)
    .set({ payload: sql`json_remove(${schema.logsTable.payload}, '$.photoBlob')` })
    .where(
      and(
        eq(schema.logsTable.logType, 'note'),
        sql`json_extract(${schema.logsTable.payload}, '$.photoBlob') is not null`,
        ...(onlyLocal ? [sql`json_extract(${schema.logsTable.payload}, '$.photoUri') is not null`] : []),
      ),
    );
}

/**
 * Photos that never went up: added before photo sync existed, on rows already synced. They are queued as an
 * edit (a newer version, or the server would ignore it as already known), so the next push uploads them.
 */
export async function queueUnsyncedPhotos() {
  const now = Date.now();
  await db
    .update(schema.childrenTable)
    .set({ syncStatus: 'pending', updatedAt: now })
    .where(
      and(
        eq(schema.childrenTable.syncStatus, 'synced'),
        eq(schema.childrenTable.isDeleted, false),
        isNotNull(schema.childrenTable.photoUri),
        isNull(schema.childrenTable.photoBlob),
      ),
    );
  await db
    .update(schema.logsTable)
    .set({ syncStatus: 'pending', updatedAt: now })
    .where(
      and(
        eq(schema.logsTable.syncStatus, 'synced'),
        eq(schema.logsTable.logType, 'note'),
        eq(schema.logsTable.isDeleted, false),
        sql`json_extract(${schema.logsTable.payload}, '$.photoUri') is not null`,
        sql`json_extract(${schema.logsTable.payload}, '$.photoBlob') is null`,
      ),
    );
}

/**
 * Before a push: encrypts each new photo with its own key, uploads it, and records the reference on the row
 * (in place, so the push carries it). The row's version is untouched; if it was edited meanwhile, the
 * reference is saved with the next push instead. Returns whether any row changed (the loaded stores are stale then).
 */
export async function uploadPhotos(api: SyncSession, children: Child[], logs: LogEntry[]): Promise<boolean> {
  let changed = false;
  for (const child of children) {
    if (!needsPhotoUpload(child)) continue;
    const blob = await upload(api, child.photoUri!);
    if (blob === TOO_LARGE) continue;
    // A missing file: forget it, so the entry syncs without a photo instead of retrying forever.
    const change = blob ? { photoBlob: blob } : { photoUri: null };
    Object.assign(child, change);
    changed = true;
    await db
      .update(schema.childrenTable)
      .set(change)
      .where(and(eq(schema.childrenTable.id, child.id), eq(schema.childrenTable.updatedAt, child.updatedAt)));
  }
  for (const log of logs) {
    if (!needsPhotoUpload(log) || log.payload.type !== 'note') continue;
    const blob = await upload(api, log.payload.photoUri!);
    if (blob === TOO_LARGE) continue;
    const { photoUri: _, ...note } = log.payload;
    log.payload = blob ? { ...log.payload, photoBlob: blob } : note;
    changed = true;
    await db
      .update(schema.logsTable)
      .set({ payload: log.payload })
      .where(and(eq(schema.logsTable.id, log.id), eq(schema.logsTable.updatedAt, log.updatedAt)));
  }
  return changed;
}

const TOO_LARGE = 'tooLarge';

/**
 * Encrypts and uploads one photo. null when its file is gone (the row then drops the photo); TOO_LARGE when it
 * exceeds the server's limit or the server refuses it (403/413): it stays on this phone only and the entry syncs without it, so it can't block sync.
 */
async function upload(api: SyncSession, uri: string): Promise<PhotoBlob | null | typeof TOO_LARGE> {
  const size = photoSize(uri);
  if (size !== null && encryptedFileSize(size) > MAX_BLOB_BYTES) {
    console.warn('[sync] a photo is too large to sync; it stays on this phone');
    return TOO_LARGE;
  }
  const data = await readPhotoBytes(uri);
  if (!data) return null;
  const key = newSymmetricKey();
  const id = uuidv7();
  try {
    await api.putBlob(id, encryptFile(key, data));
  } catch (e) {
    // The server won't keep it (the family's photo allowance is full, or it's over that server's own limit): the
    // photo stays on this phone and the entry syncs without it, like one that's too large.
    if (e instanceof SyncHttpError && (e.status === 403 || e.status === 413)) {
      console.warn(`[sync] the server refused a photo (${e.status}); it stays on this phone`);
      return TOO_LARGE;
    }
    throw e;
  }
  return { id, key: toBase64(key) };
}

/**
 * After a pull: downloads the photos this phone doesn't have yet (from other phones) and links them to their
 * rows, without touching the rows' versions. Returns how many arrived.
 */
export async function downloadPhotos(api: SyncSession, onProgress: (done: number) => void): Promise<number> {
  const children = await db
    .select({ id: schema.childrenTable.id, blob: schema.childrenTable.photoBlob })
    .from(schema.childrenTable)
    .where(and(eq(schema.childrenTable.isDeleted, false), isNotNull(schema.childrenTable.photoBlob), isNull(schema.childrenTable.photoUri)));
  const notes = await db
    .select({ id: schema.logsTable.id, payload: schema.logsTable.payload })
    .from(schema.logsTable)
    .where(
      and(
        eq(schema.logsTable.logType, 'note'),
        eq(schema.logsTable.isDeleted, false),
        sql`json_extract(${schema.logsTable.payload}, '$.photoBlob') is not null`,
        sql`json_extract(${schema.logsTable.payload}, '$.photoUri') is null`,
      ),
    );

  let done = 0;
  for (const { id, blob } of children) {
    const uri = await download(api, blob!);
    if (!uri) continue;
    // Only if the row still wants this photo (a newer version may have arrived meanwhile).
    const res = await db
      .update(schema.childrenTable)
      .set({ photoUri: uri })
      .where(and(eq(schema.childrenTable.id, id), sql`json_extract(${schema.childrenTable.photoBlob}, '$.id') = ${blob!.id}`));
    if (!res.changes) deletePhoto(uri);
    else onProgress(++done);
  }
  for (const { id, payload } of notes) {
    if (payload.type !== 'note' || !payload.photoBlob) continue;
    const uri = await download(api, payload.photoBlob);
    if (!uri) continue;
    const res = await db
      .update(schema.logsTable)
      .set({ payload: sql`json_set(${schema.logsTable.payload}, '$.photoUri', ${uri})` })
      .where(and(eq(schema.logsTable.id, id), sql`json_extract(${schema.logsTable.payload}, '$.photoBlob.id') = ${payload.photoBlob.id}`));
    if (!res.changes) deletePhoto(uri);
    else onProgress(++done);
  }
  return done;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function download(api: SyncSession, blob: PhotoBlob): Promise<string | null> {
  // The id comes from another phone's record and becomes a file name: only ever a UUID, never a path.
  if (!UUID.test(blob.id)) return null;
  const data = await api.getBlob(blob.id);
  if (!data) return null; // replaced or deleted on the server since; the next pull brings the newer version
  let bytes: Uint8Array;
  try {
    bytes = decryptFile(fromBase64(blob.key), data);
  } catch (e) {
    // Damaged or tampered with on the server: skipped (retried next run), so one photo can't stop sync.
    console.warn(`[sync] photo ${blob.id} doesn't decrypt`, e);
    return null;
  }
  return savePhotoBytes(`${blob.id}.jpg`, bytes);
}
