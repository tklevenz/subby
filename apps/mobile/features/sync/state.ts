import { create } from 'zustand';
import { useSettingsStore, type SyncSettings } from '../../store/useSettingsStore';
import { deviceIdentity } from './keystore';
import { SyncSession } from './api';

export type SyncStatus = {
  phase: 'off' | 'idle' | 'syncing' | 'error';
  error: string | null;
  /** Local changes not yet uploaded. */
  pending: number;
  /** During a long first upload or download. */
  progress: { label: string; done: number } | null;
  /** The family's phones, from the verified device log. */
  members: { id: string; isMe: boolean }[];
  /** Phones that joined since this phone last looked (shown once as a heads-up). */
  newDevices: string[];
  /** Another phone removed this one from the family: it can only turn sync off. */
  removed: boolean;
  /** This phone's sync identity is gone (a restored backup, a new phone): it can only turn sync off and join again. */
  identityLost: boolean;
  /** Whether the family has a recovery key (from the verified device log). */
  hasRecovery: boolean;
  /** Local changes too large for the server, left unsynced (a very long note). */
  tooLarge: number;
  /** The family just moved to this server (this phone followed): shown once. */
  movedTo: string | null;
  /** The last run that failed, kept after later runs succeed (for diagnostics). */
  lastError: { message: string; at: number } | null;
};


/** What the status holds with sync off: also what turning sync off goes back to (except `lastError`, kept for support). */
export const INITIAL_STATUS: SyncStatus = {
  phase: 'off',
  error: null,
  pending: 0,
  progress: null,
  members: [],
  newDevices: [],
  removed: false,
  identityLost: false,
  hasRecovery: false,
  tooLarge: 0,
  movedTo: null,
  lastError: null,
};

export const useSyncStore = create<SyncStatus>(() => INITIAL_STATUS);

let session: SyncSession | null = null;
export function sessionFor(s: SyncSettings) {
  if (!session || session.server !== s.server || session.deviceId !== s.deviceId) {
    session = new SyncSession(s.server, s.deviceId, deviceIdentity());
  }
  return session;
}
/** The next request logs in again (after a server switch or turning sync off). */
export const dropSession = () => {
  session = null;
};

export const syncSettings = () => useSettingsStore.getState().sync;
export const saveSync = (patch: Partial<SyncSettings>) => {
  const current = syncSettings();
  return current ? useSettingsStore.getState().set('sync', { ...current, ...patch }) : Promise.resolve();
};

/** The settings of a phone that just began syncing with a family (set up, joined, recovered). */
export const newSyncSettings = (f: { server: string; familyId: string; deviceId: string; knownDevices: string[]; logSeen: NonNullable<SyncSettings['logSeen']> }): SyncSettings => ({
  server: f.server,
  familyId: f.familyId,
  deviceId: f.deviceId,
  lastSeq: 0,
  lastSyncedAt: null,
  since: Date.now(),
  knownDevices: f.knownDevices,
  photosFamily: f.familyId,
  logSeen: f.logSeen,
});
