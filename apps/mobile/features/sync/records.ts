import type { Child, LogEntry, LogPayload } from '@kindred-log/shared';

/**
 * What a child or log entry looks like inside its encrypted sync record. Device-local fields stay out:
 * photo file paths (photos sync separately) and Baby Buddy import refs (per-device import bookkeeping).
 */
export type ChildBody = Pick<Child, 'name' | 'birthDate' | 'birthTime' | 'dueDate' | 'sex'>;
export type LogBody = Pick<LogEntry, 'childId' | 'logType' | 'startedAt' | 'endedAt' | 'createdBy' | 'payload'>;

export const childToBody = (c: Child): ChildBody => ({
  name: c.name,
  birthDate: c.birthDate,
  birthTime: c.birthTime,
  dueDate: c.dueDate,
  sex: c.sex,
});

export function logToBody(l: LogEntry): LogBody {
  const { photoUri: _, ...payload } = l.payload as LogPayload & { photoUri?: string };
  return { childId: l.childId, logType: l.logType, startedAt: l.startedAt, endedAt: l.endedAt, createdBy: l.createdBy, payload: payload as LogPayload };
}

type Version = { updatedAt: number };

/** A pulled child as a local row, keeping this device's photo and import ref for the same id. */
export function bodyToChild(id: string, body: ChildBody, v: Version, local: Child | undefined): Child {
  return {
    ...body,
    id,
    photoUri: local?.photoUri ?? null,
    importRef: local?.importRef ?? null,
    updatedAt: v.updatedAt,
    isDeleted: false,
    syncStatus: 'synced',
  };
}

export function bodyToLog(id: string, body: LogBody, v: Version, local: LogEntry | undefined): LogEntry {
  const localPhoto = local?.payload.type === 'note' ? local.payload.photoUri : undefined;
  const payload = (body.payload.type === 'note' && localPhoto ? { ...body.payload, photoUri: localPhoto } : body.payload) as LogPayload;
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
  importRef: null,
  updatedAt,
  isDeleted: true,
  syncStatus,
});

/** A deleted log keeps only its id and type; nothing personal stays behind. */
export const scrubbedPayload = (type: LogPayload['type']) => ({ type }) as LogPayload;
