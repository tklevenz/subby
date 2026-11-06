import { create } from 'zustand';
import { eq } from 'drizzle-orm';
import { DEFAULT_FAMILY_ALERTS, DEFAULT_REMINDERS, type FamilyAlertSettings, type ReminderSettings, type UnitSystem } from '@kindred-log/shared';
import type { LogSeen } from '@kindred-log/shared/crypto';
import type { MovedBody } from '@kindred-log/shared/sync';
import { db, schema } from '../db/client';

export type Settings = {
  units: UnitSystem;
  clock: '12h' | '24h';
  activeChildId: string | null;
  /** Device-local: each caregiver picks their own notifications. */
  reminders: ReminderSettings;
  /** Device-local: notifications when another phone logs a sleep (not a reminder, so not under its switch). */
  familyAlerts: FamilyAlertSettings;
  /** Last Baby Buddy server used for import (the API key is never stored). */
  bbUrl: string | null;
  /** Home tile pinned to the top, per child id (default sleep). Set by long-pressing a tile. */
  homeTop: Record<string, HomeTile>;
  /** Device-local sync state; null until sync is set up. Keys live in the keychain (features/sync/keystore). */
  sync: SyncSettings | null;
};

export type SyncSettings = {
  server: string;
  familyId: string;
  deviceId: string;
  /** Last server sequence number pulled. */
  lastSeq: number;
  lastSyncedAt: number | null;
  /** Display names of the family's phones by device id (synced encrypted as `device` records). */
  names?: Record<string, string>;
  /** Devices this phone has already seen in the family, to point out new ones. */
  knownDevices?: string[];
  /** Whether the server wakes this phone with push when others write (hosted Subby Sync does). */
  push?: boolean;
  /** The family this phone's photo references belong to; differs (or is missing) after moving to another family. */
  photosFamily?: string;
  /** The push token (FCM on Android) last registered with the server (re-registered when it changes). */
  pushToken?: string;
  /** How far this phone has verified the device log, so a server can't serve an older one (`assertLogContinues`). */
  logSeen?: LogSeen;
  /** Another phone moved the family to another server (a `moved` record): this phone follows on its next sync run. */
  move?: MovedBody;
};

export type HomeTile = 'sleep' | 'feed' | 'diaper';

const DEFAULTS: Settings = {
  units: 'metric',
  clock: '24h',
  activeChildId: null,
  reminders: DEFAULT_REMINDERS,
  familyAlerts: DEFAULT_FAMILY_ALERTS,
  bbUrl: null,
  homeTop: {},
  sync: null,
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
    const familyAlerts = { ...DEFAULTS.familyAlerts, ...stored.familyAlerts };
    setState({ ...DEFAULTS, ...stored, reminders, familyAlerts, hydrated: true });
  },

  set: async (key, value) => {
    // Memory first: a read-modify-write that starts before this write finishes (e.g. two quick saveSync
    // calls) must already see the new value, or it writes the old one back.
    setState({ [key]: value } as Partial<Settings>);
    if (value === null) {
      // The column is NOT NULL: a cleared setting is a missing row, which hydrates back to its default.
      await db.delete(schema.settingsTable).where(eq(schema.settingsTable.key, key));
    } else {
      await db
        .insert(schema.settingsTable)
        .values({ key, value })
        .onConflictDoUpdate({ target: schema.settingsTable.key, set: { value } });
    }
  },
}));
