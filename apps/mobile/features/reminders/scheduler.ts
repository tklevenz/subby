import { t, formatClock } from '@subby/shared/i18n';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import type * as NotificationsModule from 'expo-notifications';
import { router } from 'expo-router';
import { REMINDER_ID_PREFIX, activeReminderCount, isNap, isRunning, type LogType, medicationsDue, planReminders, predictNextSleep, type ReminderChild, DAY_MS } from '@subby/shared';
import { optionalModule } from '../optionalModule';
import { fetchLogs } from '../../store/queries';
import { useChildStore } from '../../store/useChildStore';
import { useLogStore } from '../../store/useLogStore';
import { useSettingsStore, type Settings } from '../../store/useSettingsStore';

const CHANNEL = 'reminders';

/**
 * expo-notifications crashes on import in Expo Go on Android (missing native module since
 * SDK 53), so it's loaded lazily and reminders are disabled where it can't run.
 */
export const Notifications = optionalModule(() => require('expo-notifications') as typeof NotificationsModule, 'expo-go-android');

/** False in Expo Go on Android; reminders need a development build there. */
export const remindersAvailable = Notifications !== null;

Notifications?.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function notificationsAllowed(): Promise<boolean> {
  if (!Notifications) return false;
  return (await Notifications.getPermissionsAsync()).granted;
}

/** Denied for good: the phone won't ask again, so only the system settings can allow them. Not "never asked". */
export async function notificationsBlocked(): Promise<boolean> {
  if (!Notifications) return false;
  const p = await Notifications.getPermissionsAsync();
  return !p.granted && !p.canAskAgain;
}

async function ensureChannel() {
  if (!Notifications || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: t('channel.reminders'),
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/** Ask for permission (shown by the OS only once). Returns whether notifications are allowed. */
export async function requestNotifications(): Promise<boolean> {
  if (!Notifications) return false;
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Master switch. Turning it on asks for permission if any reminder kind is set up. */
export async function setRemindersEnabled(on: boolean) {
  const { reminders, set } = useSettingsStore.getState();
  if (on && activeReminderCount({ ...reminders, enabled: true }) > 0) await requestNotifications();
  await set('reminders', { ...reminders, enabled: on });
}

/** What each child's reminders need, read from SQLite (not just the active child's window). */
async function reminderChild(id: string, name: string, now: number): Promise<ReminderChild> {
  const [recent, meds] = await Promise.all([
    // Includes running timers of any age.
    fetchLogs(id, { from: now - 8 * DAY_MS }),
    fetchLogs(id, { from: now - 30 * DAY_MS, types: ['medication'] }),
  ]);
  const lastStart = (type: LogType) => recent.filter((l) => l.logType === type && !isRunning(l)).at(-1)?.startedAt ?? null;
  const child = useChildStore.getState().children.find((c) => c.id === id)!;
  return {
    id,
    name,
    lastFeedAt: lastStart('feed'),
    feedRunning: recent.some((l) => l.logType === 'feed' && isRunning(l)),
    lastDiaperAt: lastStart('diaper'),
    lastPumpAt: lastStart('pumping'),
    timers: recent.filter(isRunning).map((l) => ({
      id: l.id,
      type: l.logType,
      startedAt: l.startedAt,
      nap: l.payload.type === 'sleep' ? isNap(l as Parameters<typeof isNap>[0]) : undefined,
    })),
    meds: medicationsDue([...meds].reverse()),
    nextSleep: predictNextSleep(recent.filter((l) => l.logType === 'sleep'), child, now),
  };
}

/** Replace our scheduled notifications with the current plan. */
async function sync() {
  if (!Notifications) return;
  const { reminders, clock, sync: syncSettings } = useSettingsStore.getState();
  const anyEnabled = activeReminderCount(reminders) > 0;
  const scheduled = (await Notifications.getAllScheduledNotificationsAsync()).filter((n) =>
    n.identifier.startsWith(REMINDER_ID_PREFIX),
  );

  const now = Date.now();
  const plan =
    anyEnabled && (await notificationsAllowed())
      ? planReminders({
          now,
          settings: reminders,
          children: await Promise.all(useChildStore.getState().children.map((c) => reminderChild(c.id, c.name, now))),
          formatTime: (ms) => formatClock(ms, clock),
          checkBeforeDosing: sharedWithoutPush(syncSettings),
        })
      : [];

  if (plan.length) await ensureChannel();
  const wanted = new Set(plan.map((p) => p.id));
  await Promise.all(
    scheduled.filter((n) => !wanted.has(n.identifier)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  // Scheduling with an existing identifier replaces that notification.
  for (const p of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: p.id,
      content: { title: p.title, body: p.body, data: { childId: p.childId, entryId: p.entryId ?? null } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.at, channelId: CHANNEL },
    });
  }
}

/** Other phones log too, but this one only hears about it when the app opens (no push on this server). */
const sharedWithoutPush = (s: Settings['sync']) => Boolean(s && !s.push && (s.knownDevices?.length ?? 1) > 1);

let running: Promise<void> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | undefined;

/** Queues one re-plan after the ones already running, so two never overlap. */
function queueSync(): Promise<void> {
  running = running.then(sync).catch((e) => console.warn('Reminder sync failed', e)); // i18n-ignore
  return running;
}

/** Re-plans now and resolves when done (background tasks, which may be stopped right after). */
export function replanReminders(): Promise<void> {
  clearTimeout(timer);
  return queueSync();
}

/** Debounced, serialized re-plan. Call after anything that could move a reminder. */
export function scheduleReminderSync(delayMs = 1000) {
  clearTimeout(timer);
  timer = setTimeout(() => void queueSync(), delayMs);
}

/** Pending reminders, soonest first (for the settings screen). */
export async function upcomingReminders() {
  if (!Notifications) return [];
  const all = await Notifications.getAllScheduledNotificationsAsync();
  return all
    .filter((n) => n.identifier.startsWith(REMINDER_ID_PREFIX))
    .map((n) => {
      const t = n.trigger as { type?: string; value?: number; date?: number } | null;
      return { id: n.identifier, title: n.content.title ?? '', at: t?.value ?? t?.date ?? null };
    })
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

/**
 * Keeps notifications in step with the data: re-plans when logs, children or reminder
 * settings change and when the app comes back to the foreground. Tapping a reminder
 * switches to that child (and opens the entry for forgotten timers).
 */
export function useReminderSync(ready: boolean) {
  useEffect(() => {
    if (!ready || !Notifications) return;
    scheduleReminderSync(0);
    const unsubs = [
      useLogStore.subscribe((s, prev) => s.revision !== prev.revision && scheduleReminderSync()),
      useChildStore.subscribe((s, prev) => s.children !== prev.children && scheduleReminderSync()),
      useSettingsStore.subscribe(
        (s, prev) =>
          (s.reminders !== prev.reminders || s.clock !== prev.clock || sharedWithoutPush(s.sync) !== sharedWithoutPush(prev.sync)) &&
          scheduleReminderSync(0),
      ),
    ];
    const appState = AppState.addEventListener('change', (state) => state === 'active' && scheduleReminderSync());
    const tap = Notifications.addNotificationResponseReceivedListener(async (res) => {
      const { childId, entryId } = res.notification.request.content.data ?? {};
      if (typeof childId === 'string' && useChildStore.getState().children.some((c) => c.id === childId)) {
        await useSettingsStore.getState().set('activeChildId', childId);
      }
      // Forgotten-timer reminders open the entry so it can be stopped or corrected.
      if (typeof entryId === 'string') router.push(`/entry/${entryId}`);
    });
    return () => {
      unsubs.forEach((u) => u());
      appState.remove();
      tap.remove();
    };
  }, [ready]);
}
