import { Platform } from 'react-native';
import { INACTIVE_DELETE_DAYS, INACTIVE_WARN_DAYS } from '@subby/shared/sync';
import { Notifications } from '../reminders/scheduler';

const ID = 'kl-sync:inactive';
const CHANNEL = 'sync';
const DAY = 86_400_000;
let plannedAt = 0;

/**
 * Hosted Subby Sync deletes a family no phone has synced for a year (`inactiveDays`, D5), and the website promises a
 * warning in the app a month before. A phone that stopped syncing can't hear that from the server, so it warns
 * itself: each sync schedules a notification for 11 months later, which the next sync pushes back again (at most
 * once a day per app start). It only fires on a phone that really hasn't synced since. Not for servers that keep
 * families (`inactiveDays` null), and gone when sync is turned off.
 */
export async function planInactivityWarning(inactiveDays: number | null | undefined, now = Date.now()) {
  if (!Notifications) return;
  if (!inactiveDays) return cancelInactivityWarning();
  if (now - plannedAt < DAY) return;
  plannedAt = now;
  const warnDays = inactiveDays - (INACTIVE_DELETE_DAYS - INACTIVE_WARN_DAYS);
  const deletes = new Date(now + inactiveDays * DAY).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Subby Sync', importance: Notifications.AndroidImportance.DEFAULT });
  }
  await Notifications.scheduleNotificationAsync({
    identifier: ID,
    content: {
      title: "Subby hasn't synced in 11 months",
      body: `Open Subby to keep your family on Subby Sync. If no phone syncs by ${deletes}, its synced data is deleted from the server, gifted unlocks included. Your phones keep everything.`,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: now + warnDays * DAY, channelId: CHANNEL },
  });
}

export async function cancelInactivityWarning() {
  plannedAt = 0;
  await Notifications?.cancelScheduledNotificationAsync(ID).catch(() => {});
}
