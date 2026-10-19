import { create } from 'zustand';
import type { UnitSystem } from '@kindred-log/shared';
import { db, schema } from '../db/client';

export type Settings = {
  units: UnitSystem;
  clock: '12h' | '24h';
  activeChildId: string | null;
  feedReminderMin: number | null;
  /** Entitlement stub until payments exist (gates CSV export, multiple children). */
  isPremium: boolean;
};

const DEFAULTS: Settings = {
  units: 'metric',
  clock: '24h',
  activeChildId: null,
  feedReminderMin: null,
  isPremium: false,
};

interface SettingsState extends Settings {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((setState) => ({
  ...DEFAULTS,
  hydrated: false,

  hydrate: async () => {
    const rows = await db.select().from(schema.settingsTable);
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Partial<Settings>;
    setState({ ...DEFAULTS, ...stored, hydrated: true });
  },

  set: async (key, value) => {
    await db
      .insert(schema.settingsTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.settingsTable.key, set: { value } });
    setState({ [key]: value } as Partial<Settings>);
  },
}));
