import { scryptAsync } from '@noble/hashes/scrypt.js';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { z } from 'zod';
import { bytesToJson, concatBytes, jsonToBytes, utf8ToBytes } from '../crypto/bytes';
import { decryptFile, encryptFile } from '../crypto/files';
import { randomBytes } from '../crypto/random';
import { ChildSchema, type Child } from '../schemas/child.schema';
import { LenientPayloadSchema, LogEntrySchema, type LogEntry, type LogPayload } from '../schemas/log.schema';

/**
 * A full backup of a phone's data: every child and entry (tombstones too, so a restore doesn't bring back
 * something deleted later) plus the photos, in one zip. Optionally encrypted with a passphrase.
 * Device-local fields stay out: photo paths (the photos themselves are in the zip), sync references and status.
 */
export const BACKUP_FORMAT = 'subby-backup';
// Backups made before the rename (2026-11-08) still restore; never drop it.
const LEGACY_BACKUP_FORMAT = 'kindred-log-backup';
export const BACKUP_VERSION = 1;
const MANIFEST = 'backup.json';

export type BackupChild = Omit<Child, 'photoUri' | 'photoBlob' | 'syncStatus' | 'isDeleted'> & { photo?: string };
export type BackupLog = Omit<LogEntry, 'syncStatus' | 'isDeleted'> & { photo?: string };
/** A deleted child or entry: only what's needed to delete it on restore. */
export type BackupTombstone = { kind: 'child' | 'log'; id: string; updatedAt: number };

export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: number;
  children: BackupChild[];
  logs: BackupLog[];
  deleted: BackupTombstone[];
};

/** A backup read back: valid rows, photos by their name in the zip, and how many rows were unreadable. */
export type BackupContents = { backup: Backup; photos: Map<string, Uint8Array>; invalid: number };

// --- writing ----------------------------------------------------------------------------------------------

const photoExt = (uri: string) => {
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'jpg';
};

const withoutPhoto = (p: LogPayload): LogPayload => {
  if (p.type !== 'note') return p;
  const { photoUri: _, photoBlob: __, ...note } = p;
  return note;
};

/**
 * Builds the backup zip. `photos` holds the bytes of each local photo by its uri; a photo missing there
 * (file gone) is left out. Photos are stored as they are (already compressed), the manifest deflated.
 */
export function makeBackup(input: { children: Child[]; logs: LogEntry[]; photos: ReadonlyMap<string, Uint8Array>; createdAt: number }): Uint8Array {
  const files: Zippable = {};
  let n = 0;
  const addPhoto = (uri: string | null | undefined) => {
    const data = uri ? input.photos.get(uri) : undefined;
    if (!uri || !data) return undefined;
    // Our own names, never derived from row data.
    const name = `photos/${++n}.${photoExt(uri)}`;
    files[name] = [data, { level: 0 }];
    return name;
  };

  const backup: Backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: input.createdAt, children: [], logs: [], deleted: [] };
  for (const c of input.children) {
    if (c.isDeleted) {
      backup.deleted.push({ kind: 'child', id: c.id, updatedAt: c.updatedAt });
      continue;
    }
    const { photoUri, photoBlob: _, syncStatus: __, isDeleted: ___, ...row } = c;
    const photo = addPhoto(photoUri);
    backup.children.push(photo ? { ...row, photo } : row);
  }
  for (const l of input.logs) {
    if (l.isDeleted) {
      backup.deleted.push({ kind: 'log', id: l.id, updatedAt: l.updatedAt });
      continue;
    }
    const { syncStatus: _, isDeleted: __, ...row } = l;
    const photo = addPhoto(l.payload.type === 'note' ? l.payload.photoUri : undefined);
    const entry = { ...row, payload: withoutPhoto(l.payload) };
    backup.logs.push(photo ? { ...entry, photo } : entry);
  }

  files[MANIFEST] = jsonToBytes(backup);
  return zipSync(files, { level: 6 });
}

// --- reading ----------------------------------------------------------------------------------------------

export class BackupError extends Error {}

const photoRef = z.string().regex(/^photos\/\d+\.[a-z0-9]{1,5}$/).optional();

const BackupChildSchema = ChildSchema.omit({ photoUri: true, photoBlob: true, syncStatus: true, isDeleted: true }).extend({ photo: photoRef });

// The payload is checked leniently (field types, not values): a backup must restore what the app stored, even
// values a stricter schema would reject, but nothing a screen would crash on. Photo fields are device-local and dropped.
const BackupLogSchema = LogEntrySchema.omit({ syncStatus: true, isDeleted: true, payload: true })
  .extend({ payload: LenientPayloadSchema, photo: photoRef })
  .refine((l) => l.payload.type === l.logType, 'payload type differs from logType');

const TombstoneSchema = z.object({ kind: z.enum(['child', 'log']), id: z.uuid(), updatedAt: z.number().int() });

const ManifestSchema = z.object({
  format: z.enum([BACKUP_FORMAT, LEGACY_BACKUP_FORMAT]),
  version: z.number().int(),
  createdAt: z.number().int(),
  children: z.array(z.unknown()),
  logs: z.array(z.unknown()),
  deleted: z.array(z.unknown()),
});

/** Photo names in a backup (ours, see `makeBackup`). */
const BACKUP_PHOTO = /^photos\/\d+\.[a-z0-9]{1,5}$/;
/** Headroom over the zip's own size: the JSON compresses well, photos barely. */
const MAX_INFLATED = 64 * 2 ** 20;

/** Reads a backup zip. Throws BackupError if it isn't one; single unreadable rows are skipped and counted. */
export function readBackup(zip: Uint8Array): BackupContents {
  let files: Record<string, Uint8Array>;
  try {
    // Only the files a backup has, and no more than a real one could inflate to: a crafted zip can't exhaust memory.
    let inflated = 0;
    files = unzipSync(zip, {
      filter: (f) => {
        if (f.name !== MANIFEST && !BACKUP_PHOTO.test(f.name)) return false;
        inflated += f.originalSize;
        if (inflated > MAX_INFLATED + 4 * zip.length) throw new BackupError('This backup is damaged');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError('This file is damaged or not a Subby backup');
  }
  if (!files[MANIFEST]) throw new BackupError('This file is not a Subby backup');
  let raw: unknown;
  try {
    raw = bytesToJson(files[MANIFEST]);
  } catch {
    throw new BackupError('This backup is damaged');
  }
  const manifest = ManifestSchema.safeParse(raw);
  if (!manifest.success) throw new BackupError('This file is not a Subby backup');
  if (manifest.data.version > BACKUP_VERSION) throw new BackupError('This backup was made by a newer version of the app. Update the app first.');

  let invalid = 0;
  const valid = <S extends z.ZodType>(schema: S, rows: unknown[]): z.output<S>[] =>
    rows.flatMap((r) => {
      const res = schema.safeParse(r);
      if (res.success) return [res.data];
      invalid++;
      return [];
    });

  const children = valid(BackupChildSchema, manifest.data.children) as BackupChild[];
  const logs = valid(BackupLogSchema, manifest.data.logs).map((l) => ({ ...l, payload: withoutPhoto(l.payload as LogPayload) })) as BackupLog[];
  const deleted = valid(TombstoneSchema, manifest.data.deleted);

  const photos = new Map<string, Uint8Array>();
  for (const row of [...children, ...logs]) {
    if (!row.photo) continue;
    const data = files[row.photo];
    if (data) photos.set(row.photo, data);
    else delete row.photo;
  }
  return { backup: { ...manifest.data, format: BACKUP_FORMAT, children, logs, deleted }, photos, invalid };
}

// --- passphrase encryption ----------------------------------------------------------------------------------

// "KLBK" || version || scrypt log2(N), r, p || salt (16), then the zip encrypted in chunks (crypto/files).
const MAGIC = utf8ToBytes('KLBK');
const SALT_BYTES = 16;
const HEADER_BYTES = MAGIC.length + 4 + SALT_BYTES;

/** scrypt N = 2^15, r = 8 (32 MB): a second or so on a phone, per guess. The parameters travel in the header. */
export const BACKUP_KDF = { logN: 15, r: 8, p: 1 };

export const isEncryptedBackup = (bytes: Uint8Array) => bytes.length >= HEADER_BYTES && MAGIC.every((b, i) => bytes[i] === b);

const deriveKey = (passphrase: string, salt: Uint8Array, kdf: typeof BACKUP_KDF, onProgress?: (p: number) => void) =>
  scryptAsync(utf8ToBytes(passphrase.normalize('NFKC')), salt, { N: 2 ** kdf.logN, r: kdf.r, p: kdf.p, dkLen: 32, onProgress });

export async function encryptBackup(zip: Uint8Array, passphrase: string, onProgress?: (p: number) => void, kdf = BACKUP_KDF): Promise<Uint8Array> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(passphrase, salt, kdf, onProgress);
  return concatBytes(MAGIC, new Uint8Array([1, kdf.logN, kdf.r, kdf.p]), salt, encryptFile(key, zip));
}

/** The zip inside an encrypted backup. Throws BackupError on a wrong passphrase. */
export async function decryptBackup(bytes: Uint8Array, passphrase: string, onProgress?: (p: number) => void): Promise<Uint8Array> {
  if (!isEncryptedBackup(bytes)) throw new BackupError('This backup is not encrypted');
  const [version, logN, r, p] = bytes.subarray(MAGIC.length, MAGIC.length + 4);
  // Bounds keep a crafted header from asking for too much memory (128 · 2^logN · r bytes: at most 64 MiB here;
  // ours, BACKUP_KDF, takes 32 MiB).
  if (version !== 1 || logN < 10 || logN > 16 || r < 1 || r > 8 || p !== 1) throw new BackupError('This backup is damaged or from a newer app');
  const salt = bytes.subarray(MAGIC.length + 4, HEADER_BYTES);
  const key = await deriveKey(passphrase, salt, { logN, r, p }, onProgress);
  try {
    return decryptFile(key, bytes.subarray(HEADER_BYTES));
  } catch {
    throw new BackupError('Wrong passphrase, or the file is damaged');
  }
}

// --- restoring --------------------------------------------------------------------------------------------

/** Same rule as sync: the newer edit wins; an equal version means it's already there. */
export const backupWins = (local: { updatedAt: number } | undefined, incoming: { updatedAt: number }) =>
  local === undefined || incoming.updatedAt > local.updatedAt;

export type RestorePlan = {
  children: BackupChild[];
  logs: BackupLog[];
  /** Tombstones newer than a local row that still exists. */
  deletions: BackupTombstone[];
  /** Rows whose local copy is the same or newer (deletions only count where this phone has the row). */
  unchanged: number;
};

/**
 * One version per row: the newest, whether live or deleted. Ours never has two, but a hand-edited file could, and
 * the restore must not apply an older tombstone after a newer entry, or the other way round.
 */
function latestOnly(backup: Backup): Backup {
  const newest = new Map<string, number>();
  const note = (key: string, updatedAt: number) => newest.set(key, Math.max(newest.get(key) ?? -Infinity, updatedAt));
  for (const c of backup.children) note(`child:${c.id}`, c.updatedAt);
  for (const l of backup.logs) note(`log:${l.id}`, l.updatedAt);
  for (const t of backup.deleted) note(`${t.kind}:${t.id}`, t.updatedAt);
  // Ties go to the tombstone (it's the later state of the same edit), and only the first of equal copies stays.
  const kept = new Set<string>();
  const keep = (key: string, updatedAt: number) => {
    if (kept.has(key) || newest.get(key) !== updatedAt) return false;
    kept.add(key);
    return true;
  };
  const deleted = backup.deleted.filter((t) => keep(`${t.kind}:${t.id}`, t.updatedAt));
  return {
    ...backup,
    deleted,
    children: backup.children.filter((c) => keep(`child:${c.id}`, c.updatedAt)),
    logs: backup.logs.filter((l) => keep(`log:${l.id}`, l.updatedAt)),
  };
}

/** What a restore would change, given the local versions (live and deleted rows) by id. */
export function planRestore(
  backup: Backup,
  local: { children: ReadonlyMap<string, { updatedAt: number; isDeleted: boolean }>; logs: ReadonlyMap<string, { updatedAt: number; isDeleted: boolean }> },
): RestorePlan {
  const plan: RestorePlan = { children: [], logs: [], deletions: [], unchanged: 0 };
  backup = latestOnly(backup);
  for (const c of backup.children) {
    if (backupWins(local.children.get(c.id), c)) plan.children.push(c);
    else plan.unchanged++;
  }
  for (const l of backup.logs) {
    if (backupWins(local.logs.get(l.id), l)) plan.logs.push(l);
    else plan.unchanged++;
  }
  for (const t of backup.deleted) {
    const row = (t.kind === 'child' ? local.children : local.logs).get(t.id);
    // Nothing to delete if this phone never had it; already deleted, or edited since, counts as up to date.
    if (!row) continue;
    if (!row.isDeleted && backupWins(row, t)) plan.deletions.push(t);
    else plan.unchanged++;
  }
  return plan;
}
