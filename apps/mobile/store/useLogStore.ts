import { create } from 'zustand';
import { eq, and, desc, gte, isNull, or, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, schema } from '../db/client';
import { deletePhoto } from '../features/photos';
import {
  TIMED_LOG_TYPES,
  pauseFeed,
  type LogEntry,
  type LogPayload,
  type PayloadOf,
} from '@kindred-log/shared';

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;

export type LogPatch = {
  payload?: Partial<LogPayload>;
  startedAt?: number;
  endedAt?: number | null;
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
  /** An entry from memory, else from the database (e.g. older than the loaded window). */
  getLog: (id: string) => Promise<LogEntry | undefined>;
}

const photoOf = (p: LogPayload) => (p.type === 'note' ? p.photoUri : undefined);

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
    if (!childId) throw new Error('No active child');
    const now = Date.now();
    const startedAt = times.startedAt ?? now;
    const timed = TIMED_LOG_TYPES.includes(payload.type);
    const entry: LogEntry = {
      id: uuidv7(),
      childId,
      logType: payload.type,
      startedAt,
      endedAt: times.endedAt !== undefined ? times.endedAt : timed ? startedAt : null,
      updatedAt: now,
      isDeleted: false,
      syncStatus: 'pending',
      importRef: null,
      createdBy: null,
      payload,
    };

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

  updateLog: async (id, patch) => {
    const current = await get().getLog(id);
    if (!current) return;

    const updated: LogEntry = {
      ...current,
      payload: patch.payload ? ({ ...current.payload, ...patch.payload } as LogPayload) : current.payload,
      startedAt: patch.startedAt ?? current.startedAt,
      endedAt: patch.endedAt !== undefined ? patch.endedAt : current.endedAt,
      updatedAt: Date.now(),
      syncStatus: 'pending',
    };
    // A new or removed photo: drop the synced reference so the next sync uploads the new one (or none).
    if (photoOf(current.payload) !== photoOf(updated.payload) && updated.payload.type === 'note') {
      const { photoBlob: _, ...payload } = updated.payload;
      updated.payload = payload;
    }

    await db
      .update(schema.logsTable)
      .set({
        payload: updated.payload,
        startedAt: updated.startedAt,
        endedAt: updated.endedAt,
        updatedAt: updated.updatedAt,
        syncStatus: 'pending',
      })
      .where(eq(schema.logsTable.id, id));
    if (photoOf(current.payload) !== photoOf(updated.payload)) deletePhoto(photoOf(current.payload));

    set((state) => {
      // Keep the in-memory window consistent: an entry may move into or out of it.
      const others = state.logs.filter((l) => l.id !== id);
      // Running timers are always loaded, however old (see loadLogs).
      const inWindow = updated.childId === state.activeChildId && (updated.startedAt >= state.loadedSince || (updated.endedAt === null && TIMED_LOG_TYPES.includes(updated.logType)));
      return {
        logs: inWindow ? [...others, updated].sort(byStartedDesc) : others,
        revision: state.revision + 1,
      };
    });
  },

  softDeleteLog: async (id: string) => {
    const current = await get().getLog(id);
    const now = Date.now();
    await db
      .update(schema.logsTable)
      // Only the id and type stay behind (for sync); nothing personal is kept in a deleted entry.
      .set({ isDeleted: true, payload: sql`json_object('type', ${schema.logsTable.logType})`, updatedAt: now, syncStatus: 'pending' })
      .where(eq(schema.logsTable.id, id));
    if (current) deletePhoto(photoOf(current.payload));

    set((state) => ({
      logs: state.logs.filter((log) => log.id !== id),
      revision: state.revision + 1,
    }));
  },

  getLog: async (id) =>
    get().logs.find((l) => l.id === id) ??
    (await db
      .select()
      .from(schema.logsTable)
      .where(and(eq(schema.logsTable.id, id), eq(schema.logsTable.isDeleted, false)))
      .get()),
}));
