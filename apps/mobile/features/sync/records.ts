import { z } from 'zod';
import { ChildSchema, LenientPayloadSchema, LogEntrySchema, PhotoBlobSchema, type Child, type LogEntry, type LogPayload, type PhotoBlob } from '@subby/shared';
import type { RecordKind } from '@subby/shared/sync';

/**
 * What a child or log entry looks like inside its encrypted sync record. Device-local fields stay out:
 * photo file paths (the photo itself syncs as an encrypted blob, referenced by `photoBlob`) and Baby Buddy
 * import refs (per-device import bookkeeping).
 */
export type ChildBody = Pick<Child, 'name' | 'birthDate' | 'birthTime' | 'dueDate' | 'sex'> & { photoBlob: PhotoBlob | null };
export type LogBody = Pick<LogEntry, 'childId' | 'logType' | 'startedAt' | 'endedAt' | 'createdBy' | 'payload'>;

// What a pulled record's body must look like before it touches the database. Payloads are checked leniently
// (`LenientPayloadSchema`: field types, not values; photo reference well-formed), so values another phone stored
// are never dropped for being unusual, but nothing reaches a screen that would crash it.
const BODY_SCHEMAS: Record<RecordKind, z.ZodTypeAny> = {
  child: ChildSchema.pick({ name: true, birthDate: true, birthTime: true, dueDate: true, sex: true }).extend({ photoBlob: PhotoBlobSchema.nullable() }),
  log: LogEntrySchema.pick({ childId: true, logType: true, startedAt: true, endedAt: true, createdBy: true })
    .extend({ payload: LenientPayloadSchema })
    .refine((l) => l.payload.type === l.logType),
  device: z.object({ name: z.string().min(1).max(100) }),
  moved: z.object({ server: z.string().regex(/^https?:\/\/\S+$/i).max(300), familyId: z.uuid(), from: z.uuid(), seq: z.number().int().nonnegative() }),
};

/** Whether a decrypted body from another phone is well-formed for its kind. */
export const isValidBody = (kind: RecordKind, body: unknown) => validBody(kind, body) !== null;

/**
 * The body as checked (nulls in optional payload fields become missing), or null when it's malformed. A kind this
 * app doesn't know (from a newer app) is null too, so it's skipped instead of stopping sync.
 */
export function validBody<T>(kind: RecordKind, body: unknown): T | null {
  const schema = BODY_SCHEMAS[kind] as z.ZodTypeAny | undefined;
  const res = schema?.safeParse(body);
  return res?.success ? (res.data as T) : null;
}

export const childToBody = (c: Child): ChildBody => ({
  name: c.name,
  birthDate: c.birthDate,
  birthTime: c.birthTime,
  dueDate: c.dueDate,
  sex: c.sex,
  photoBlob: c.photoBlob ?? null,
});

const noteBlob = (p: LogPayload) => (p.type === 'note' ? p.photoBlob : undefined);

/** The blob ids a row's record lists, so the server can delete photos nothing uses any more. */
export const blobIdsOf = (row: Child | LogEntry): string[] => {
  const blob = 'logType' in row ? noteBlob(row.payload) : row.photoBlob;
  return blob ? [blob.id] : [];
};

/** A row whose photo still has to be uploaded: a local file, no synced reference yet. */
export const needsPhotoUpload = (row: Child | LogEntry): boolean =>
  'logType' in row
    ? row.payload.type === 'note' && Boolean(row.payload.photoUri) && !row.payload.photoBlob
    : Boolean(row.photoUri) && !row.photoBlob;

export function logToBody(l: LogEntry): LogBody {
  const { photoUri: _, ...payload } = l.payload as LogPayload & { photoUri?: string };
  return { childId: l.childId, logType: l.logType, startedAt: l.startedAt, endedAt: l.endedAt, createdBy: l.createdBy, payload: payload as LogPayload };
}

type Version = { updatedAt: number };

/** This device's copy of a photo stays only while the record still points at the same blob. */
const keepLocalPhoto = (localUri: string | null | undefined, localBlob: PhotoBlob | null | undefined, blob: PhotoBlob | null | undefined) =>
  localUri && blob && localBlob?.id === blob.id ? localUri : null;

/** A pulled child as a local row, keeping this device's photo copy and import ref for the same id. */
export function bodyToChild(id: string, body: ChildBody, v: Version, local: Child | undefined): Child {
  const photoBlob = body.photoBlob ?? null;
  return {
    ...body,
    id,
    photoBlob,
    photoUri: keepLocalPhoto(local?.photoUri, local?.photoBlob, photoBlob),
    importRef: local?.importRef ?? null,
    updatedAt: v.updatedAt,
    isDeleted: false,
    syncStatus: 'synced',
  };
}

export function bodyToLog(id: string, body: LogBody, v: Version, local: LogEntry | undefined): LogEntry {
  let payload = body.payload;
  if (payload.type === 'note') {
    const { photoUri: _, ...note } = payload;
    const localNote = local?.payload.type === 'note' ? local.payload : undefined;
    const photoUri = keepLocalPhoto(localNote?.photoUri, localNote?.photoBlob, note.photoBlob);
    payload = photoUri ? { ...note, photoUri } : note;
  }
  return {
    ...body,
    payload,
    id,
    importRef: local?.importRef ?? null,
    updatedAt: v.updatedAt,
    isDeleted: false,
    syncStatus: 'synced',
  };
}

/** Scrubbed child tombstone (same shape `deleteChild` leaves behind). */
export const childTombstone = (id: string, updatedAt: number, syncStatus: 'pending' | 'synced'): Child => ({
  id,
  name: '',
  birthDate: '',
  birthTime: null,
  dueDate: null,
  sex: null,
  photoUri: null,
  photoBlob: null,
  importRef: null,
  updatedAt,
  isDeleted: true,
  syncStatus,
});

/** A deleted log keeps only its id and type; nothing personal stays behind. */
export const scrubbedPayload = (type: LogPayload['type']) => ({ type }) as LogPayload;
