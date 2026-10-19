import { create } from 'zustand';
import { eq, and, desc } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, schema } from '../db/client';
import { LogEntry, LogPayload } from '@kindred/shared';

interface LogState {
  activeChildId: string;
  logs: LogEntry[];
  isLoading: boolean;

  loadLogs: (childId: string) => Promise<void>;
  addLog: (payload: LogPayload, startedAt?: number) => Promise<void>;
  updateLog: (id: string, payload: Partial<LogPayload>) => Promise<void>;
  softDeleteLog: (id: string) => Promise<void>;
}

export const useLogStore = create<LogState>((set, get) => ({
  activeChildId: 'default-child-uuid', // Replaced during onboarding
  logs: [],
  isLoading: false,

  loadLogs: async (childId: string) => {
    set({ isLoading: true, activeChildId: childId });
    const rows = await db
      .select()
      .from(schema.logsTable)
      .where(
        and(
          eq(schema.logsTable.childId, childId),
          eq(schema.logsTable.isDeleted, false),
        )
      )
      .orderBy(desc(schema.logsTable.startedAt))
      .limit(100);

    set({ logs: rows, isLoading: false });
  },

  addLog: async (payload: LogPayload, startedAt = Date.now()) => {
    const now = Date.now();
    const newEntry: LogEntry = {
      id: uuidv7(),
      childId: get().activeChildId,
      logType: payload.type,
      startedAt,
      updatedAt: now,
      isDeleted: false,
      syncStatus: 'pending',
      payload,
    };

    // 1. Write to encrypted local SQLite
    await db.insert(schema.logsTable).values(newEntry);

    // 2. Update Zustand state immediately and keep sorted by startedAt DESC
    set((state) => ({
      logs: [newEntry, ...state.logs].sort((a, b) => b.startedAt - a.startedAt),
    }));
  },

  updateLog: async (id: string, payloadPatch: Partial<LogPayload>) => {
    const now = Date.now();
    const current = get().logs.find((l) => l.id === id);
    if (!current) return;

    const mergedPayload: LogPayload = {
      ...current.payload,
      ...payloadPatch,
    } as LogPayload;

    // 1. Upsert in SQLite
    await db
      .update(schema.logsTable)
      .set({
        payload: mergedPayload,
        updatedAt: now,
        syncStatus: 'pending',
      })
      .where(eq(schema.logsTable.id, id));

    // 2. Reflect in Zustand
    set((state) => ({
      logs: state.logs.map((l) =>
        l.id === id ? { ...l, payload: mergedPayload, updatedAt: now } : l,
      ),
    }));
  },

  softDeleteLog: async (id: string) => {
    const now = Date.now();
    await db
      .update(schema.logsTable)
      .set({ isDeleted: true, updatedAt: now, syncStatus: 'pending' })
      .where(eq(schema.logsTable.id, id));

    set((state) => ({
      logs: state.logs.filter((log) => log.id !== id),
    }));
  },
}));
