import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Child, LogEntry, PhotoBlob } from '@subby/shared';
import { decryptFile, encryptFile, encryptedFileSize, fromBase64, newSymmetricKey, toBase64 } from '@subby/shared/crypto';
import { MAX_BLOB_BYTES } from '@subby/shared/sync';
import { db, schema } from '../../db/client';
import { deletePhoto, photoSize, readPhotoBytes, savePhotoBytes } from '../photos';
import { isHttpError, type SyncSession } from './api';
import { needsPhotoUpload } from './records';

const c = schema.childrenTable;
const l = schema.logsTable;

/** A note's `photoBlob` (the synced reference) or `photoUri` (the file on this phone) is set / not set. */
const noteHas = (field: 'photoBlob' | 'photoUri', set = true) =>
  sql`json_extract(${l.payload}, ${sql.raw(`'$.${field}'`)}) is ${sql.raw(set ? 'not null' : 'null')}`;
/** The same for a child's columns. */
const childHas = (field: 'photoBlob' | 'photoUri', set = true) => (set ? isNotNull(c[field]) : isNull(c[field]));

/**
 * Photo references point at blobs on one server, for one family. A phone starting or joining another family
 * (a new server, or setting sync up again) forgets them, so its photos upload to the new family. With
 * `onlyLocal`, only rows whose photo file is on this phone are touched (they're the ones it can re-upload); with
 * `onlyPending`, only rows waiting to be pushed.
 */
export async function forgetPhotoUploads({ onlyLocal = false, onlyPending = false } = {}) {
  await db
    .update(c)
    .set({ photoBlob: null })
    .where(and(childHas(onlyLocal ? 'photoUri' : 'photoBlob'), ...(onlyPending ? [eq(c.syncStatus, 'pending')] : [])));
  await db
    .update(l)
    .set({ payload: sql`json_remove(${l.payload}, '$.photoBlob')` })
    .where(and(eq(l.logType, 'note'), noteHas('photoBlob'), ...(onlyLocal ? [noteHas('photoUri')] : []), ...(onlyPending ? [eq(l.syncStatus, 'pending')] : [])));
}

/**
 * Photos that never went up: added before photo sync existed, on rows already synced. They are queued as an
 * edit (a newer version, or the server would ignore it as already known), so the next push uploads them.
 */
export async function queueUnsyncedPhotos() {
  const now = Date.now();
  await db
    .update(c)
    .set({ syncStatus: 'pending', updatedAt: now })
    .where(and(eq(c.syncStatus, 'synced'), eq(c.isDeleted, false), childHas('photoUri'), childHas('photoBlob', false)));
  await db
    .update(l)
    .set({ syncStatus: 'pending', updatedAt: now })
    .where(and(eq(l.syncStatus, 'synced'), eq(l.logType, 'note'), eq(l.isDeleted, false), noteHas('photoUri'), noteHas('photoBlob', false)));
}

/**
 * Before a push: encrypts each new photo with its own key, uploads it, and records the reference on the row
 * (in place, so the push carries it). The row's version is untouched; if it was edited meanwhile, the
 * reference is saved with the next push instead. Returns whether any row changed (the loaded stores are stale then),
 * and the rows whose photo couldn't go up because the server was busy (429): they stay out of this push, pending, so
 * they go up with their photo on the next run.
 */
export async function uploadPhotos(api: SyncSession, children: Child[], logs: LogEntry[]): Promise<{ changed: boolean; busy: string[] }> {
  let changed = false;
  const busy: string[] = [];
  // Once the server is busy, the other photos wait for the next run too.
  const send = async (row: { id: string }, uri: string) => {
    const blob = busy.length ? BUSY : await upload(api, uri);
    if (blob === BUSY) busy.push(row.id);
    return blob;
  };
  for (const child of children) {
    if (!needsPhotoUpload(child)) continue;
    const blob = await send(child, child.photoUri!);
    if (blob === TOO_LARGE || blob === BUSY) continue;
    // A missing file: forget it, so the entry syncs without a photo instead of retrying forever.
    const change = blob ? { photoBlob: blob } : { photoUri: null };
    Object.assign(child, change);
    changed = true;
    await db
      .update(c)
      .set(change)
      .where(and(eq(c.id, child.id), eq(c.updatedAt, child.updatedAt)));
  }
  for (const log of logs) {
    if (!needsPhotoUpload(log) || log.payload.type !== 'note') continue;
    const blob = await send(log, log.payload.photoUri!);
    if (blob === TOO_LARGE || blob === BUSY) continue;
    const { photoUri: _, ...note } = log.payload;
    log.payload = blob ? { ...log.payload, photoBlob: blob } : note;
    changed = true;
    await db
      .update(l)
      .set({ payload: log.payload })
      .where(and(eq(l.id, log.id), eq(l.updatedAt, log.updatedAt)));
  }
  return { changed, busy };
}

const TOO_LARGE = 'tooLarge';
const BUSY = 'busy';
/** The server is busy (429: too many photo transfers at once, or its limits): try again later, nothing is wrong. */
const isBusy = (e: unknown) => isHttpError(e, 429);
const BUSY_TRIES = 5;

/**
 * Encrypts and uploads one photo. null when its file is gone (the row then drops the photo); TOO_LARGE when it
 * exceeds the server's limit or the server refuses it (403/413): it stays on this phone only and the entry syncs without it, so it can't block sync.
 */
async function upload(api: SyncSession, uri: string): Promise<PhotoBlob | null | typeof TOO_LARGE | typeof BUSY> {
  const size = photoSize(uri);
  if (size !== null && encryptedFileSize(size) > MAX_BLOB_BYTES) { // i18n-ignore
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
    if (isHttpError(e, 403, 413)) {
      console.warn(`[sync] the server refused a photo (${e.status}); it stays on this phone`);
      return TOO_LARGE;
    }
    if (isBusy(e)) return BUSY;
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
    .select({ id: c.id, blob: c.photoBlob })
    .from(c)
    .where(and(eq(c.isDeleted, false), childHas('photoBlob'), childHas('photoUri', false)));
  const notes = await db
    .select({ id: l.id, payload: l.payload })
    .from(l)
    .where(and(eq(l.logType, 'note'), eq(l.isDeleted, false), noteHas('photoBlob'), noteHas('photoUri', false)));

  let done = 0;
  // Once the server is busy (429), the rest wait for the next run: their rows still lack the file, so they're asked again.
  let busy = false;
  const download = async (blob: PhotoBlob) => {
    if (busy) return null;
    try {
      return await downloadOne(api, blob);
    } catch (e) {
      if (!isBusy(e)) throw e;
      busy = true;
      return null;
    }
  };
  for (const { id, blob } of children) {
    const uri = await download(blob!);
    if (!uri) continue;
    // Only if the row still wants this photo (a newer version may have arrived meanwhile).
    const res = await db
      .update(c)
      .set({ photoUri: uri })
      .where(and(eq(c.id, id), sql`json_extract(${c.photoBlob}, '$.id') = ${blob!.id}`));
    if (!res.changes) deletePhoto(uri);
    else onProgress(++done);
  }
  for (const { id, payload } of notes) {
    if (payload.type !== 'note' || !payload.photoBlob) continue;
    const uri = await download(payload.photoBlob);
    if (!uri) continue;
    const res = await db
      .update(l)
      .set({ payload: sql`json_set(${l.payload}, '$.photoUri', ${uri})` })
      .where(and(eq(l.id, id), sql`json_extract(${l.payload}, '$.photoBlob.id') = ${payload.photoBlob.id}`));
    if (!res.changes) deletePhoto(uri);
    else onProgress(++done);
  }
  return done;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function downloadOne(api: SyncSession, blob: PhotoBlob): Promise<string | null> {
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

/**
 * Uploads every photo this phone has under its existing blob id and key, so records stay as they are: to a new
 * server (moving), or to one restored from a backup (`tolerant`: a photo it still has (409), or has no room for,
 * is skipped, so one photo can't stop the rest).
 */
export async function uploadPhotosAsTheyAre(api: SyncSession, onProgress: (done: number) => void, tolerant = false) {
  const children = await db
    .select({ uri: c.photoUri, blob: c.photoBlob })
    .from(c)
    .where(and(eq(c.isDeleted, false), childHas('photoUri'), childHas('photoBlob')));
  const notes = await db
    .select({ payload: l.payload })
    .from(l)
    .where(and(eq(l.logType, 'note'), eq(l.isDeleted, false), noteHas('photoBlob'), noteHas('photoUri')));
  const photos = [
    ...children.map((r) => ({ uri: r.uri!, blob: r.blob! })),
    ...notes.flatMap(({ payload: p }) => (p.type === 'note' && p.photoUri && p.photoBlob ? [{ uri: p.photoUri, blob: p.photoBlob }] : [])),
  ];
  let done = 0;
  for (const { uri, blob } of photos) {
    const data = await readPhotoBytes(uri);
    // A missing file: the entry moves without it, like any photo that never synced.
    if (!data) continue;
    const sealed = encryptFile(fromBase64(blob.key), data);
    try {
      // Every photo has to go up here (a move, a restored server), so a busy server is waited for, a few times.
      for (let attempt = 1; ; attempt++) {
        try {
          await api.putBlob(blob.id, sealed);
          break;
        } catch (e) {
          if (!isBusy(e) || attempt >= BUSY_TRIES) throw e;
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
    } catch (e) {
      if (!(tolerant && isHttpError(e, 403, 409, 413))) throw e;
    }
    onProgress(++done);
  }
}
