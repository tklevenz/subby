import { create } from 'zustand';
import { asc, eq, notInArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Child } from '@kindred-log/shared';
import { db, schema } from '../db/client';

export type ChildInput = Pick<Child, 'name' | 'birthDate'> &
  Partial<Pick<Child, 'birthTime' | 'dueDate' | 'sex' | 'photoUri' | 'importRef'>>;

interface ChildState {
  children: Child[];
  hydrate: () => Promise<void>;
  addChild: (input: ChildInput) => Promise<Child>;
  updateChild: (id: string, patch: Partial<ChildInput>) => Promise<void>;
  softDeleteChild: (id: string) => Promise<void>;
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
    const isFirst = get().children.length === 0;
    await db.insert(schema.childrenTable).values(child);

    // Logs recorded before children existed (v0 placeholder child id) belong to the first child.
    if (isFirst) {
      await db
        .update(schema.logsTable)
        .set({ childId: child.id, updatedAt: Date.now(), syncStatus: 'pending' })
        .where(notInArray(schema.logsTable.childId, [child.id]));
    }

    set((state) => ({ children: [...state.children, child] }));
    return child;
  },

  updateChild: async (id, patch) => {
    const now = Date.now();
    await db
      .update(schema.childrenTable)
      .set({ ...patch, updatedAt: now, syncStatus: 'pending' })
      .where(eq(schema.childrenTable.id, id));
    set((state) => ({
      children: state.children.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: now } : c)),
    }));
  },

  softDeleteChild: async (id) => {
    await db
      .update(schema.childrenTable)
      .set({ isDeleted: true, updatedAt: Date.now(), syncStatus: 'pending' })
      .where(eq(schema.childrenTable.id, id));
    set((state) => ({ children: state.children.filter((c) => c.id !== id) }));
  },
}));
