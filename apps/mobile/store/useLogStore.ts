import { create } from 'zustand';
import { eq, and, desc, gte, isNull, or, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, schema } from '../db/client';
import { deletePhoto } from '../features/photos';
import { deletedLogs } from '../db/tombstone';
import {
  TIMED_LOG_TYPES,
  notePhoto,
  pauseFeed,
  type LogEntry,
  type LogPayload,
  type PayloadOf,
} from '@subby/shared';

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;

export type LogPatch = {
  payload?: Partial<LogPayload>;
  startedAt?: number;
  endedAt?: number | null;
};

export type LogWrites = {
  add?: { payload: LogPayload; startedAt: number; endedAt: number | null }[];
  update?: { id: string; patch: LogPatch }[];
  remove?: string[];
};

interface LogState {
  activeChildId: string | null;
  logs: LogEntry[];
  isLoading: boolean;
  /** Oldest startedAt currently loaded; older entries are paged in by loadOlder(). */
  loadedSince: number;
  /** Bumped on every write, including to entries outside the loaded window (see useLogQuery). */
  revision: number;

  loadLogs: (childId: string) => Promise<void>;
  loadOlder: () => Promise<void>;
  /** Log a completed entry. Timed types default endedAt to startedAt (an instant event). */
  addLog: (payload: LogPayload, times?: { startedAt?: number; endedAt?: number | null }) => Promise<LogEntry>;
  /** Start a live timer: a timed entry with endedAt = null. */
  startTimer: (payload: LogPayload, startedAt?: number) => Promise<LogEntry>;
  stopTimer: (id: string, patch?: Omit<LogPatch, 'endedAt'>) => Promise<void>;
  /** Works for any entry, loaded or not. */
  updateLog: (id: string, patch: LogPatch) => Promise<void>;
  softDeleteLog: (id: string) => Promise<void>;
  /** Several deletes at once (a night's pieces): one transaction, one `revision` bump. */
  deleteLogs: (ids: string[]) => Promise<void>;
  /** Adds, edits and deletes together, atomically: either all of them are written or none, and readers re-read once. */
  writeLogs: (writes: LogWrites) => Promise<void>;
  /** An entry from memory, else from the database (e.g. older than the loaded window). */
  getLog: (id: string) => Promise<LogEntry | undefined>;
}

/** The entry as an edit leaves it. A new or removed photo drops the synced reference, so the next sync uploads the new one (or none). */
function applyPatch(current: LogEntry, patch: LogPatch): LogEntry {
  const updated: LogEntry = {
    ...current,
    payload: patch.payload ? ({ ...current.payload, ...patch.payload } as LogPayload) : current.payload,
    startedAt: patch.startedAt ?? current.startedAt,
    endedAt: patch.endedAt !== undefined ? patch.endedAt : current.endedAt,
    updatedAt: Date.now(),
    syncStatus: 'pending',
  };
  if (notePhoto(current.payload) !== notePhoto(updated.payload) && updated.payload.type === 'note') {
    const { photoBlob: _, ...payload } = updated.payload;
    updated.payload = payload;
  }
  return updated;
}

function newEntry(childId: string, payload: LogPayload, startedAt: number, endedAt: number | null): LogEntry {
  return {
    id: uuidv7(),
    childId,
    logType: payload.type,
    startedAt,
    endedAt,
    updatedAt: Date.now(),
    isDeleted: false,
    syncStatus: 'pending',
    importRef: null,
    createdBy: null,
    payload,
  };
}

const byStartedDesc = (a: LogEntry, b: LogEntry) => b.startedAt - a.startedAt;

export const useLogStore = create<LogState>((set, get) => ({
  activeChildId: null,
  logs: [],
  isLoading: false,
  loadedSince: 0,
  revision: 0,

  loadLogs: async (childId: string) => {
    set({ isLoading: true, activeChildId: childId });
    const since = Date.now() - WINDOW_DAYS * DAY_MS;
    const t = schema.logsTable;
    const rows = await db
      .select()
      .from(t)
      .where(
        and(
          eq(t.childId, childId),
          eq(t.isDeleted, false),
          // Always include running timers, however old.
          or(gte(t.startedAt, since), and(isNull(t.endedAt), inArray(t.logType, [...TIMED_LOG_TYPES]))),
        ),
      )
      .orderBy(desc(t.startedAt));

    // Ignore results for a child that's no longer active (fast switching).
    if (get().activeChildId !== childId) return;
    set((s) => ({ logs: rows, isLoading: false, loadedSince: since, revision: s.revision + 1 }));
  },

  loadOlder: async () => {
    const { activeChildId: childId, loadedSince } = get();
    if (!childId) return;
    const since = loadedSince - WINDOW_DAYS * DAY_MS;
    const t = schema.logsTable;
    const rows = await db
      .select()
      .from(t)
      .where(and(eq(t.childId, childId), eq(t.isDeleted, false), gte(t.startedAt, since)))
      .orderBy(desc(t.startedAt));
    if (get().activeChildId !== childId) return;
    set((s) => ({ logs: rows, loadedSince: since, revision: s.revision + 1 }));
  },

  addLog: async (payload, times = {}) => {
    const childId = get().activeChildId;
    if (!childId) throw new Error('No active child'); // i18n-ignore
    const startedAt = times.startedAt ?? Date.now();
    const timed = TIMED_LOG_TYPES.includes(payload.type);
    const entry = newEntry(childId, payload, startedAt, times.endedAt !== undefined ? times.endedAt : timed ? startedAt : null);

    await db.insert(schema.logsTable).values(entry);
    set((state) => ({ logs: [entry, ...state.logs].sort(byStartedDesc), revision: state.revision + 1 }));
    return entry;
  },

  startTimer: (payload, startedAt) => get().addLog(payload, { startedAt, endedAt: null }),

  stopTimer: async (id, patch = {}) => {
    const now = Date.now();
    // From SQLite too: a running feed of a child whose entries aren't loaded must still get its side's time.
    const current = await get().getLog(id);
    // Breastfeeding: fold the running side's elapsed time into its total.
    const payload = current?.payload.type === 'feed'
      ? pauseFeed({ ...current.payload, ...(patch.payload as Partial<PayloadOf<'feed'>>) }, now)
      : patch.payload;
    return get().updateLog(id, { ...patch, payload, endedAt: now });
  },

  updateLog: (id, patch) => get().writeLogs({ update: [{ id, patch }] }),

  softDeleteLog: (id) => get().writeLogs({ remove: [id] }),

  deleteLogs: (ids) => get().writeLogs({ remove: ids }),

  writeLogs: async ({ add = [], update = [], remove = [] }) => {
    const childId = get().activeChildId;
    if (add.length > 0 && !childId) throw new Error('No active child'); // i18n-ignore
    // Read first (entries outside the loaded window come from SQLite); the writes below are one synchronous transaction.
    const edits: { before: LogEntry; after: LogEntry }[] = [];
    for (const { id, patch } of update) {
      const before = await get().getLog(id);
      if (before) edits.push({ before, after: applyPatch(before, patch) });
    }
    const removed = (await Promise.all(remove.map((id) => get().getLog(id)))).filter((l): l is LogEntry => l !== undefined);
    const added = add.map((a) => newEntry(childId!, a.payload, a.startedAt, a.endedAt));
    if (edits.length + removed.length + added.length === 0) return;

    const t = schema.logsTable;
    const now = Date.now();
    db.transaction((tx) => {
      for (const { after } of edits) {
        tx.update(t)
          .set({ payload: after.payload, startedAt: after.startedAt, endedAt: after.endedAt, updatedAt: after.updatedAt, syncStatus: 'pending' })
          .where(eq(t.id, after.id))
          .run();
      }
      for (const { id } of removed) {
        tx.update(t)
          // Only the id and type stay behind (for sync); nothing personal is kept in a deleted entry.
          .set(deletedLogs({ updatedAt: now, syncStatus: 'pending' }))
          .where(eq(t.id, id))
          .run();
      }
      for (const entry of added) tx.insert(t).values(entry).run();
    });

    for (const { before, after } of edits) {
      if (notePhoto(before.payload) !== notePhoto(after.payload)) deletePhoto(notePhoto(before.payload));
    }
    for (const entry of removed) deletePhoto(notePhoto(entry.payload));

    set((state) => {
      const touched = new Set([...edits.map((e) => e.after.id), ...removed.map((r) => r.id)]);
      const others = state.logs.filter((l) => !touched.has(l.id));
      // Keep the in-memory window consistent: an entry may move into or out of it.
      // Running timers are always loaded, however old (see loadLogs).
      const inWindow = ({ childId: c, startedAt, endedAt, logType }: LogEntry) =>
        c === state.activeChildId && (startedAt >= state.loadedSince || (endedAt === null && TIMED_LOG_TYPES.includes(logType)));
      return {
        logs: [...others, ...edits.map((e) => e.after).filter(inWindow), ...added].sort(byStartedDesc),
        revision: state.revision + 1,
      };
    });
  },

  getLog: async (id) =>
    get().logs.find((l) => l.id === id) ??
    (await db
      .select()
      .from(schema.logsTable)
      .where(and(eq(schema.logsTable.id, id), eq(schema.logsTable.isDeleted, false)))
      .get()),
}));
