import { create } from 'zustand';
import { and, asc, count, eq, min, notInArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Child, LogPayload, LogType } from '@kindred-log/shared';
import { db, schema } from '../db/client';
import { deletePhoto } from '../features/photos';
import { useSettingsStore } from './useSettingsStore';

export type ChildInput = Pick<Child, 'name' | 'birthDate'> &
  Partial<Pick<Child, 'birthTime' | 'dueDate' | 'sex' | 'photoUri' | 'importRef'>>;

interface ChildState {
  children: Child[];
  hydrate: () => Promise<void>;
  addChild: (input: ChildInput) => Promise<Child>;
  updateChild: (id: string, patch: Partial<ChildInput>) => Promise<void>;
  /**
   * Permanently delete a child and everything logged for them. The child and its logs stay as
   * scrubbed tombstones (id and type only, so sync can delete them on other phones too);
   * reminders and photos are removed outright.
   */
  deleteChild: (id: string) => Promise<void>;
}

/** Number of (non-deleted) entries per type for a child, for the delete warning. */
export async function countChildLogs(childId: string): Promise<Partial<Record<LogType, number>>> {
  const t = schema.logsTable;
  const rows = await db
    .select({ logType: t.logType, n: count() })
    .from(t)
    .where(and(eq(t.childId, childId), eq(t.isDeleted, false)))
    .groupBy(t.logType);
  return Object.fromEntries(rows.map((r) => [r.logType, r.n]));
}

/** Total entries and the first entry's time, for the profile page. */
export async function childSummary(childId: string): Promise<{ total: number; firstAt: number | null }> {
  const t = schema.logsTable;
  const [row] = await db
    .select({ total: count(), firstAt: min(t.startedAt) })
    .from(t)
    .where(and(eq(t.childId, childId), eq(t.isDeleted, false)));
  return { total: row?.total ?? 0, firstAt: row?.firstAt ?? null };
}

/** Children included without Premium. */
export const FREE_CHILD_LIMIT = 1;

export const canAddChild = (childCount: number, isPremium: boolean) => isPremium || childCount < FREE_CHILD_LIMIT;

/** Whether another child can be added right now (false = show the Premium upsell). */
export function useCanAddChild() {
  const count = useChildStore((s) => s.children.length);
  const isPremium = useSettingsStore((s) => s.isPremium);
  return canAddChild(count, isPremium);
}

export const useChildStore = create<ChildState>((set, get) => ({
  children: [],

  hydrate: async () => {
    const rows = await db
      .select()
      .from(schema.childrenTable)
      .where(eq(schema.childrenTable.isDeleted, false))
      .orderBy(asc(schema.childrenTable.birthDate));
    set({ children: rows });
  },

  addChild: async (input) => {
    const child: Child = {
      id: uuidv7(),
      name: input.name,
      birthDate: input.birthDate,
      birthTime: input.birthTime ?? null,
      dueDate: input.dueDate ?? null,
      sex: input.sex ?? null,
      photoUri: input.photoUri ?? null,
      updatedAt: Date.now(),
      isDeleted: false,
      syncStatus: 'pending',
      importRef: input.importRef ?? null,
    };
    // Enforced here too, so no path (e.g. an import) can get around the UI gates.
    if (!canAddChild(get().children.length, useSettingsStore.getState().isPremium)) {
      throw new Error('Adding another child requires Premium');
    }
    const isFirst = get().children.length === 0;
    await db.insert(schema.childrenTable).values(child);

    // Logs recorded before children existed (v0 placeholder child id) belong to the first child.
    // Only logs whose child row doesn't exist at all; deleted children keep theirs.
    if (isFirst) {
      await db
        .update(schema.logsTable)
        .set({ childId: child.id, updatedAt: Date.now(), syncStatus: 'pending' })
        .where(notInArray(schema.logsTable.childId, db.select({ id: schema.childrenTable.id }).from(schema.childrenTable)));
    }

    set((state) => ({ children: [...state.children, child] }));
    return child;
  },

  updateChild: async (id, patch) => {
    const now = Date.now();
    const before = get().children.find((c) => c.id === id);
    const photoChanged = patch.photoUri !== undefined && before?.photoUri !== patch.photoUri;
    // A replaced or removed photo is no longer referenced anywhere.
    if (photoChanged && before?.photoUri) deletePhoto(before.photoUri);
    // A new photo is uploaded on the next sync; dropping the old reference is what triggers that.
    const change = photoChanged ? { ...patch, photoBlob: null } : patch;
    await db
      .update(schema.childrenTable)
      .set({ ...change, updatedAt: now, syncStatus: 'pending' })
      .where(eq(schema.childrenTable.id, id));
    set((state) => ({
      children: state.children.map((c) => (c.id === id ? { ...c, ...change, updatedAt: now } : c)),
    }));
  },

  deleteChild: async (id) => {
    const child = get().children.find((c) => c.id === id);
    const notes = await db
      .select({ payload: schema.logsTable.payload })
      .from(schema.logsTable)
      .where(and(eq(schema.logsTable.childId, id), eq(schema.logsTable.logType, 'note')));

    db.transaction((tx) => {
      const now = Date.now();
      tx.update(schema.logsTable)
        .set({ isDeleted: true, payload: sql`json_object('type', ${schema.logsTable.logType})`, importRef: null, updatedAt: now, syncStatus: 'pending' })
        .where(eq(schema.logsTable.childId, id))
        .run();
      tx.delete(schema.remindersTable).where(eq(schema.remindersTable.childId, id)).run();
      // Scrub personal data; importRef is cleared so a later re-import starts fresh.
      tx.update(schema.childrenTable)
        .set({ name: '', birthDate: '', birthTime: null, dueDate: null, sex: null, photoUri: null, photoBlob: null, importRef: null, isDeleted: true, updatedAt: now, syncStatus: 'pending' })
        .where(eq(schema.childrenTable.id, id))
        .run();
    });

    deletePhoto(child?.photoUri);
    for (const { payload } of notes) deletePhoto((payload as Extract<LogPayload, { type: 'note' }>).photoUri);

    set((state) => ({ children: state.children.filter((c) => c.id !== id) }));
  },
}));
