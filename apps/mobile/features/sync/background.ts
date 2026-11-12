import { Platform } from 'react-native';
import type * as BackgroundTaskModule from 'expo-background-task';
import type * as NotificationsModule from 'expo-notifications';
import type * as TaskManagerModule from 'expo-task-manager';
import { appReady } from '../startup';
import { optionalModule } from '../optionalModule';
import { replanReminders } from '../reminders/scheduler';
import { useSettingsStore } from '../../store/useSettingsStore';
import type { RegisterPushResponse } from '@subby/shared/sync';
import { checkServer } from './api';
import { syncNow } from './engine';
import { saveSync, sessionFor, syncSettings } from './state';

/** Periodic sync for everyone (as often as the OS allows, at best every 15 minutes). */
const SYNC_TASK = 'subby-sync-periodic';
/** Runs when a hosted server's "sync now" push arrives while the app is in the background. */
const PUSH_TASK = 'subby-sync-push';

// Background tasks and push need a development or store build; Expo Go has neither, on either platform (unlike the
// reminders' local notifications, which iOS Expo Go can schedule), so these skip Expo Go everywhere.
const TaskManager = optionalModule(() => require('expo-task-manager') as typeof TaskManagerModule, 'expo-go');
const BackgroundTask = optionalModule(() => require('expo-background-task') as typeof BackgroundTaskModule, 'expo-go');
const Notifications = optionalModule(() => require('expo-notifications') as typeof NotificationsModule, 'expo-go');

/** Pulls and pushes, then re-plans reminders, so a feed logged on another phone moves this phone's reminder. */
export async function backgroundSync() {
  await appReady();
  if (!useSettingsStore.getState().sync) return;
  await syncNow();
  await replanReminders();
}

/** A run started by the system, noted for diagnostics. */
async function backgroundRun(via: 'periodic' | 'push'): Promise<boolean> {
  let ok = true;
  try {
    await backgroundSync();
  } catch {
    ok = false;
  }
  await saveSync({ lastBackground: { at: Date.now(), via, ok } }).catch(() => {});
  return ok;
}

// Task definitions must run when the JS bundle loads, including headless background launches.
TaskManager?.defineTask(SYNC_TASK, async () =>
  (await backgroundRun('periodic')) ? BackgroundTask!.BackgroundTaskResult.Success : BackgroundTask!.BackgroundTaskResult.Failed,
);
TaskManager?.defineTask(PUSH_TASK, async () => {
  await backgroundRun('push');
});

/**
 * Called whenever sync starts in the foreground: makes sure the background tasks are registered, refreshes
 * whether the server sends pushes, and registers this phone's push token when it does.
 */
export async function setUpBackgroundSync() {
  const settings = syncSettings();
  if (!settings || !TaskManager) return;
  if (BackgroundTask && (await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Available) {
    if (!(await TaskManager.isTaskRegisteredAsync(SYNC_TASK))) await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: 15 });
  }

  const { push = false } = await checkServer(settings.server);
  // Push on means the server can wake this phone: it sends pushes and kept this phone's token (below).
  if (!push && settings.push) await saveSync({ push: false });
  if (!push || !Notifications) return;
  if (!(await TaskManager.isTaskRegisteredAsync(PUSH_TASK))) await Notifications.registerTaskAsync(PUSH_TASK);

  // The phone's own push token (FCM on Android), straight to the server: no Expo push service. Builds without
  // google-services.json have none, and sync when opened and in the background.
  let token: string;
  try {
    token = String((await Notifications.getDevicePushTokenAsync()).data);
  } catch {
    if (!settings.push) await saveSync({ push: true }); // pushes, but this build has no token (no google-services.json)
    return;
  }
  if (token === settings.pushToken && settings.push) return;
  // A server that can't send to this platform (an iPhone, without an APNs key) doesn't keep it: asked again next time.
  const { kept = true } = await sessionFor(settings).request<Partial<RegisterPushResponse>>('PUT', '/v1/push/token', {
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  await saveSync({ push: kept, pushToken: kept ? token : undefined });
}

/** Turning sync off: nothing left to do in the background. */
export async function stopBackgroundSync() {
  if (!TaskManager) return;
  if (BackgroundTask && (await TaskManager.isTaskRegisteredAsync(SYNC_TASK))) await BackgroundTask.unregisterTaskAsync(SYNC_TASK);
  if (Notifications && (await TaskManager.isTaskRegisteredAsync(PUSH_TASK))) await Notifications.unregisterTaskAsync(PUSH_TASK);
}

/** For diagnostics: whether the OS lets the periodic task run, and which tasks are registered. */
export async function backgroundStatus(): Promise<string> {
  if (!BackgroundTask || !TaskManager) return 'not in this build';
  const status = await BackgroundTask.getStatusAsync();
  const allowed = status === BackgroundTask.BackgroundTaskStatus.Available ? 'allowed' : 'restricted by the system';
  const periodic = (await TaskManager.isTaskRegisteredAsync(SYNC_TASK)) ? 'periodic' : null;
  const push = (await TaskManager.isTaskRegisteredAsync(PUSH_TASK)) ? 'push' : null;
  return `${allowed}, tasks: ${[periodic, push].filter(Boolean).join(' + ') || 'none'}`;
}
