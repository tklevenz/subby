import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Child, LogEntry } from '@kindred-log/shared';
import {
  decryptBackup,
  encryptBackup,
  isEncryptedBackup,
  makeBackup,
  planRestore,
  readBackup,
  type BackupContents,
  type RestorePlan,
} from '@kindred-log/shared/domain/backup';
import { db, schema } from '../db/client';
import { deletePhoto, readPhotoBytes, savePhotoBytes } from './photos';
import { childTombstone, scrubbedPayload } from './sync/records';
import { requestSync } from './sync/engine';
import { useChildStore } from '../store/useChildStore';
import { useLogStore } from '../store/useLogStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { toIsoDate } from '../store/timeHelpers';
import { downloads } from '../modules/kindred-downloads';

const notePhoto = (l: LogEntry) => (l.payload.type === 'note' ? l.payload.photoUri : undefined);

/** Android saves straight into Downloads; elsewhere (iOS) the share sheet has "Save to Files". */
export const savesToDownloads = downloads !== null;

/**
 * Writes a backup of everything on this phone into Downloads (Android), or opens the share sheet with it.
 * Without a passphrase it's a plain zip. Returns the saved file's name in Downloads, if it went there.
 */
export async function saveBackup(passphrase: string | null, onProgress?: (p: number) => void) {
  const { bytes, ...counts } = await buildBackup(passphrase, onProgress);
  const name = `subby-backup-${toIsoDate(Date.now())}.${passphrase ? 'subby' : 'zip'}`;
  const mimeType = passphrase ? 'application/octet-stream' : 'application/zip';
  const file = new File(Paths.cache, name);
  try {
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
    if (downloads) return { ...counts, savedAs: await downloads.saveToDownloads(file.uri, name, mimeType) };
    await Sharing.shareAsync(file.uri, { mimeType, UTI: passphrase ? 'public.data' : 'public.zip-archive', dialogTitle: 'Save backup' });
    return { ...counts, savedAs: null };
  } finally {
    // The share target has its own copy by now; don't leave the data in the cache.
    try {
      if (file.exists) file.delete();
    } catch {}
  }
}

async function buildBackup(passphrase: string | null, onProgress?: (p: number) => void) {
  const children = await db.select().from(schema.childrenTable);
  const logs = await db.select().from(schema.logsTable);
  const photos = new Map<string, Uint8Array>();
  for (const uri of [...children.map((c) => c.photoUri), ...logs.map(notePhoto)]) {
    if (!uri || photos.has(uri)) continue;
    const data = await readPhotoBytes(uri).catch(() => null);
    if (data) photos.set(uri, data);
  }

  const zip = makeBackup({ children, logs, photos, createdAt: Date.now() });
  return {
    bytes: passphrase ? await encryptBackup(zip, passphrase, onProgress) : zip,
    children: children.filter((c) => !c.isDeleted).length,
    logs: logs.filter((l) => !l.isDeleted).length,
    photos: photos.size,
  };
}

/** A picked backup file: still locked (needs the passphrase) or read. */
export type PickedBackup = { kind: 'locked'; bytes: Uint8Array; name: string } | { kind: 'open'; contents: BackupContents; name: string };

/** Lets the person choose a backup file. null when cancelled. */
export async function pickBackup(): Promise<PickedBackup | null> {
  const picked = await File.pickFileAsync();
  if (picked.canceled) return null;
  const bytes = await picked.result.bytes();
  const name = picked.result.name;
  return isEncryptedBackup(bytes) ? { kind: 'locked', bytes, name } : { kind: 'open', contents: readBackup(bytes), name };
}

export const unlockBackup = async (bytes: Uint8Array, passphrase: string, onProgress?: (p: number) => void) =>
  readBackup(await decryptBackup(bytes, passphrase, onProgress));

/** What restoring would do on this phone. */
export async function previewRestore(contents: BackupContents): Promise<RestorePlan> {
  const versions = (rows: { id: string; updatedAt: number; isDeleted: boolean }[]) =>
    new Map(rows.map((r) => [r.id, { updatedAt: r.updatedAt, isDeleted: r.isDeleted }]));
  const pick = { id: schema.childrenTable.id, updatedAt: schema.childrenTable.updatedAt, isDeleted: schema.childrenTable.isDeleted };
  const children = await db.select(pick).from(schema.childrenTable);
  const logs = await db
    .select({ id: schema.logsTable.id, updatedAt: schema.logsTable.updatedAt, isDeleted: schema.logsTable.isDeleted })
    .from(schema.logsTable);
  return planRestore(contents.backup, { children: versions(children), logs: versions(logs) });
}

/**
 * Applies a restore plan: newer rows from the backup replace or add to this phone's, newer deletions delete.
 * Everything changed is marked for sync, so other phones get it too.
 */
export async function restoreBackup(contents: BackupContents, plan: RestorePlan) {
  const { photos } = contents;
  // Photos first (new files, so a failed restore only leaves unused files, which are removed).
  const written: string[] = [];
  const photoUri = (ref: string | undefined) => {
    const data = ref ? photos.get(ref) : undefined;
    if (!ref || !data) return null;
    const uri = savePhotoBytes(`restored-${uuidv7()}.${ref.split('.').pop()}`, data);
    written.push(uri);
    return uri;
  };
  const children: Child[] = plan.children.map(({ photo, ...c }) => ({
    ...c,
    photoUri: photoUri(photo),
    photoBlob: null,
    isDeleted: false,
    syncStatus: 'pending',
  }));
  const logs: LogEntry[] = plan.logs.map(({ photo, ...l }) => {
    const uri = photoUri(photo);
    return { ...l, payload: uri && l.payload.type === 'note' ? { ...l.payload, photoUri: uri } : l.payload, isDeleted: false, syncStatus: 'pending' };
  });

  const replaced: (string | null | undefined)[] = [];
  try {
    db.transaction((tx) => {
      // Import refs (Baby Buddy) are unique; one already used by another row here stays with that row.
      const refs = [...children, ...logs].flatMap((r) => (r.importRef ? [r.importRef] : []));
      const taken = new Map<string, string>();
      if (refs.length) {
        for (const r of tx.select({ id: schema.childrenTable.id, ref: schema.childrenTable.importRef }).from(schema.childrenTable).where(inArray(schema.childrenTable.importRef, refs)).all()) taken.set(r.ref!, r.id);
        for (const r of tx.select({ id: schema.logsTable.id, ref: schema.logsTable.importRef }).from(schema.logsTable).where(inArray(schema.logsTable.importRef, refs)).all()) taken.set(r.ref!, r.id);
      }
      // The first restored row with a ref claims it too, so two in one backup can't break the unique index.
      const ownRef = <T extends { id: string; importRef: string | null }>(row: T): T => {
        if (!row.importRef) return row;
        const owner = taken.get(row.importRef);
        if (owner !== undefined && owner !== row.id) return { ...row, importRef: null };
        taken.set(row.importRef, row.id);
        return row;
      };

      for (const c of children.map(ownRef)) {
        const old = tx.select({ photoUri: schema.childrenTable.photoUri }).from(schema.childrenTable).where(eq(schema.childrenTable.id, c.id)).get();
        replaced.push(old?.photoUri);
        tx.insert(schema.childrenTable).values(c).onConflictDoUpdate({ target: schema.childrenTable.id, set: c }).run();
      }
      for (const l of logs.map(ownRef)) {
        const old = tx.select({ payload: schema.logsTable.payload }).from(schema.logsTable).where(eq(schema.logsTable.id, l.id)).get();
        if (old?.payload.type === 'note') replaced.push(old.payload.photoUri);
        tx.insert(schema.logsTable).values(l).onConflictDoUpdate({ target: schema.logsTable.id, set: l }).run();
      }
      // Deletions scrub the row like deleting it here would (a child's entries go with it).
      for (const d of plan.deletions) {
        if (d.kind === 'child') {
          const old = tx.select().from(schema.childrenTable).where(eq(schema.childrenTable.id, d.id)).get();
          replaced.push(old?.photoUri);
          for (const n of tx.select({ payload: schema.logsTable.payload }).from(schema.logsTable).where(eq(schema.logsTable.childId, d.id)).all()) {
            if (n.payload.type === 'note') replaced.push(n.payload.photoUri);
          }
          const row = childTombstone(d.id, d.updatedAt, 'pending');
          tx.update(schema.childrenTable).set(row).where(eq(schema.childrenTable.id, d.id)).run();
          for (const l of tx.select({ id: schema.logsTable.id, logType: schema.logsTable.logType }).from(schema.logsTable).where(eq(schema.logsTable.childId, d.id)).all()) {
            tx.update(schema.logsTable)
              .set({ isDeleted: true, payload: scrubbedPayload(l.logType), importRef: null, updatedAt: Date.now(), syncStatus: 'pending' })
              .where(eq(schema.logsTable.id, l.id))
              .run();
          }
          tx.delete(schema.remindersTable).where(eq(schema.remindersTable.childId, d.id)).run();
        } else {
          const old = tx.select().from(schema.logsTable).where(eq(schema.logsTable.id, d.id)).get();
          if (!old) continue;
          if (old.payload.type === 'note') replaced.push(old.payload.photoUri);
          tx.update(schema.logsTable)
            .set({ isDeleted: true, payload: scrubbedPayload(old.logType), importRef: null, updatedAt: d.updatedAt, syncStatus: 'pending' })
            .where(eq(schema.logsTable.id, d.id))
            .run();
        }
      }
    });
  } catch (e) {
    for (const uri of written) deletePhoto(uri);
    throw e;
  }

  for (const uri of replaced) if (uri && !written.includes(uri)) deletePhoto(uri);
  await reloadAfterRestore();
  requestSync(0);
  return { children: children.length, logs: logs.length, deletions: plan.deletions.length, photos: written.length };
}

async function reloadAfterRestore() {
  await useChildStore.getState().hydrate();
  const settings = useSettingsStore.getState();
  const kids = useChildStore.getState().children;
  const active = kids.find((c) => c.id === settings.activeChildId) ?? kids[0];
  if (active && active.id !== settings.activeChildId) await settings.set('activeChildId', active.id);
  if (active) await useLogStore.getState().loadLogs(active.id);
}
