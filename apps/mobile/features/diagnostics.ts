import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { and, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db, dbEncrypted, schema } from '../db/client';
import { useSettingsStore } from '../store/useSettingsStore';
import { TIMED_LOG_TYPES, activeReminderCount } from '@subby/shared';
import { notificationsAllowed, remindersAvailable } from './reminders/scheduler';
import { isOfficialServer } from './sync/api';
import { useSyncStore } from './sync/state';
import { useAccessStore } from './sync/access';
import { backgroundStatus } from './sync/background';

const when = (ms: number | null | undefined, now: number) => {
  if (!ms) return 'never';
  const mins = Math.round((now - ms) / 60_000);
  const ago = mins < 1 ? 'just now' : mins < 120 ? `${mins} min ago` : mins < 48 * 60 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
  return `${new Date(ms).toISOString()} (${ago})`;
};

const safely = async <T,>(f: () => Promise<T>, fallback: string): Promise<T | string> => {
  try {
    return await f();
  } catch (e) {
    return `${fallback} (${e instanceof Error ? e.message : String(e)})`;
  }
};

/**
 * A plain-text report for support (LAUNCH.md S7): the app, the phone's system, sync and reminders, and counts.
 * Nothing personal: no names, no entries, no ids, no server address unless it's the official one. Only ever shown
 * to the person, who decides whether to send it; the app never sends it by itself.
 */
export async function diagnostics(now = Date.now()): Promise<string> {
  const s = useSettingsStore.getState();
  const sync = useSyncStore.getState();
  const access = useAccessStore.getState().entitlement;
  const env = Constants.executionEnvironment === ExecutionEnvironment.StoreClient ? 'Expo Go' : __DEV__ ? 'development build' : 'release build';
  const [children] = await db.select({ n: count() }).from(schema.childrenTable).where(eq(schema.childrenTable.isDeleted, false));
  const [logs] = await db.select({ n: count() }).from(schema.logsTable).where(eq(schema.logsTable.isDeleted, false));
  const [running] = await db.select({ n: count() }).from(schema.logsTable).where(and(eq(schema.logsTable.isDeleted, false), isNull(schema.logsTable.endedAt), inArray(schema.logsTable.logType, [...TIMED_LOG_TYPES])));
  const [childPhotos] = await db.select({ n: count() }).from(schema.childrenTable).where(and(eq(schema.childrenTable.isDeleted, false), isNotNull(schema.childrenTable.photoUri)));

  const lines = [
    `Subby ${Constants.expoConfig?.version ?? '?'} (${Constants.nativeBuildVersion ?? '?'}, ${env})`,
    `${Platform.OS === 'ios' ? 'iOS' : 'Android'} ${Platform.Version}`,
    `Report made ${new Date(now).toISOString()}, time zone UTC${utcOffset(now)}`,
    '',
    `Children: ${children?.n ?? 0}, entries: ${logs?.n ?? 0} (timers running: ${running?.n ?? 0}), child photos: ${childPhotos?.n ?? 0}`,
    `Database: ${dbEncrypted ? 'encrypted' : 'not encrypted (Expo Go)'}`,
    `Units: ${s.units}, clock: ${s.clock}`,
    `Reminders: ${!remindersAvailable ? 'not in this build' : s.reminders.enabled ? `on, ${activeReminderCount(s.reminders)} active` : 'off'}, notifications ${remindersAvailable ? ((await safely(notificationsAllowed, 'unknown')) === true ? 'allowed' : 'not allowed') : '-'}`,
    `Background sync: ${await safely(backgroundStatus, 'unknown')}`,
    '',
  ];
  if (!s.sync) {
    lines.push('Sync: off');
  } else {
    lines.push(
      `Sync: ${sync.phase}${sync.progress ? ` (${sync.progress.label})` : ''}, server: ${isOfficialServer(s.sync.server) ? 'Subby Sync' : 'own server'}`,
      `Last synced: ${when(s.sync.lastSyncedAt, now)}`,
      `Last error: ${sync.lastError ? `${sync.lastError.message}, ${when(sync.lastError.at, now)}` : 'none since the app started'}`,
      `Waiting to upload: ${sync.pending}${sync.tooLarge ? `, too large for the server: ${sync.tooLarge}` : ''}`,
      `Pulled up to: ${s.sync.lastSeq}${s.sync.restoreGen ? `, server restores seen: ${s.sync.restoreGen}` : ''}`,
      `Phones in the family: ${sync.members.length}, recovery key: ${sync.hasRecovery ? 'yes' : 'no'}`,
      `Push: ${s.sync.push ? (s.sync.pushToken ? 'on, registered' : 'on, not registered') : 'off'}`,
      `Syncing since: ${when(s.sync.since, now)}`,
    );
    if (access) {
      lines.push(`Access: ${access.access}, phones: ${access.devices.map((d) => d.access).join(', ')}`);
      if (access.photoLimit) lines.push(`Photos on the server: ${Math.round(access.photoBytes / 1e6)} of ${Math.round(access.photoLimit / 1e6)} MB`);
    }
  }
  return lines.join('\n');
}

function utcOffset(now: number) {
  const m = -new Date(now).getTimezoneOffset();
  const sign = m < 0 ? '-' : '+';
  const a = Math.abs(m);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
