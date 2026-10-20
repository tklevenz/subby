import { create } from 'zustand';
import { DEFAULT_REMINDERS, type ReminderSettings, type UnitSystem } from '@kindred-log/shared';
import { db, schema } from '../db/client';

export type Settings = {
  units: UnitSystem;
  clock: '12h' | '24h';
  activeChildId: string | null;
  /** Device-local: each caregiver picks their own notifications. */
  reminders: ReminderSettings;
  /** Entitlement stub until payments exist (gates CSV export, multiple children). */
  isPremium: boolean;
  /** Last Baby Buddy server used for import (the API key is never stored). */
  bbUrl: string | null;
  /** Home tile pinned to the top, per child id (default sleep). Set by long-pressing a tile. */
  homeTop: Record<string, HomeTile>;
};

export type HomeTile = 'sleep' | 'feed' | 'diaper';

const DEFAULTS: Settings = {
  units: 'metric',
  clock: '24h',
  activeChildId: null,
  reminders: DEFAULT_REMINDERS,
  isPremium: false,
  bbUrl: null,
  homeTop: {},
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
    // Nested defaults, so reminder kinds added later get their defaults too.
    const reminders = { ...DEFAULTS.reminders, ...stored.reminders };
    setState({ ...DEFAULTS, ...stored, reminders, hydrated: true });
  },

  set: async (key, value) => {
    await db
      .insert(schema.settingsTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.settingsTable.key, set: { value } });
    setState({ [key]: value } as Partial<Settings>);
  },
}));
