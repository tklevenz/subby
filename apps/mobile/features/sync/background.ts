import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type * as BackgroundTaskModule from 'expo-background-task';
import type * as NotificationsModule from 'expo-notifications';
import type * as TaskManagerModule from 'expo-task-manager';
import { appReady } from '../startup';
import { replanReminders } from '../reminders/scheduler';
import { useSettingsStore } from '../../store/useSettingsStore';
import { checkServer } from './api';
import { saveSync, sessionFor, syncNow, syncSettings } from './engine';

/** Periodic sync for everyone (as often as the OS allows, at best every 15 minutes). */
const SYNC_TASK = 'subby-sync-periodic';
/** Runs when a hosted server's "sync now" push arrives while the app is in the background. */
const PUSH_TASK = 'subby-sync-push';

// Background tasks and push need a development or store build; Expo Go has neither (and crashes on
// importing expo-notifications on Android), so the modules are loaded lazily.
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const optional = <T>(load: () => T): T | null => {
  if (inExpoGo) return null;
  try {
    return load();
  } catch {
    return null;
  }
};
const TaskManager = optional(() => require('expo-task-manager') as typeof TaskManagerModule);
const BackgroundTask = optional(() => require('expo-background-task') as typeof BackgroundTaskModule);
const Notifications = optional(() => require('expo-notifications') as typeof NotificationsModule);

/** Pulls and pushes, then re-plans reminders, so a feed logged on another phone moves this phone's reminder. */
export async function backgroundSync() {
  await appReady();
  if (!useSettingsStore.getState().sync) return;
  await syncNow();
  await replanReminders();
}

// Task definitions must run when the JS bundle loads, including headless background launches.
TaskManager?.defineTask(SYNC_TASK, async () => {
  try {
    await backgroundSync();
    return BackgroundTask!.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask!.BackgroundTaskResult.Failed;
  }
});
TaskManager?.defineTask(PUSH_TASK, async () => {
  await backgroundSync().catch(() => {});
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
  if (push !== settings.push) await saveSync({ push });
  if (!push || !Notifications) return;
  if (!(await TaskManager.isTaskRegisteredAsync(PUSH_TASK))) await Notifications.registerTaskAsync(PUSH_TASK);

  // The phone's own push token (FCM on Android), straight to the server: no Expo push service. Builds without
  // google-services.json have none, and sync when opened and in the background.
  let token: string;
  try {
    token = String((await Notifications.getDevicePushTokenAsync()).data);
  } catch {
    return;
  }
  if (token === settings.pushToken) return;
  await sessionFor(settings).request('PUT', '/v1/push/token', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
  await saveSync({ pushToken: token });
}

/** Turning sync off: nothing left to do in the background. */
export async function stopBackgroundSync() {
  if (!TaskManager) return;
  if (BackgroundTask && (await TaskManager.isTaskRegisteredAsync(SYNC_TASK))) await BackgroundTask.unregisterTaskAsync(SYNC_TASK);
  if (Notifications && (await TaskManager.isTaskRegisteredAsync(PUSH_TASK))) await Notifications.unregisterTaskAsync(PUSH_TASK);
}
