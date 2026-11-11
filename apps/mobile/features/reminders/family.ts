import { t } from '@subby/shared/i18n';
import { Platform } from 'react-native';
import { familyAlerts, type LogEntry, DAY_MS } from '@subby/shared';
import { fetchLogs } from '../../store/queries';
import { formatTimeShort } from '../../store/timeHelpers';
import { useChildStore } from '../../store/useChildStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Notifications, notificationsAllowed } from './scheduler';

const CHANNEL = 'family';

/** An entry the sync pulled that another phone wrote. */
export type PulledLog = { before: LogEntry | null; after: LogEntry; deviceId: string };

/**
 * After a pull: shows (or withdraws) "fell asleep" / "woke up" for sleeps logged on other phones, if this phone
 * asked for them (`settings.familyAlerts`). Runs headless too, when a push wakes the app.
 */
export async function notifyFamily(pulled: PulledLog[]) {
  if (!Notifications || !pulled.some((p) => p.after.logType === 'sleep')) return;
  const { familyAlerts: settings, clock, sync } = useSettingsStore.getState();
  const children = useChildStore.getState().children;
  const now = Date.now();
  const ids = [...new Set(pulled.filter((p) => p.after.logType === 'sleep').map((p) => p.after.childId))];
  const sleeps = new Map(await Promise.all(ids.map(async (id) => [id, await fetchLogs(id, { from: now - 8 * DAY_MS, types: ['sleep'] })] as const)));

  const alerts = familyAlerts({
    changes: pulled.map((p) => ({ before: p.before, after: p.after, by: sync?.names?.[p.deviceId] ?? t('family.anotherPhone') })),
    settings,
    allowed: await notificationsAllowed(),
    sleeps: (id) => sleeps.get(id) ?? [],
    childName: (id) => children.find((c) => c.id === id)?.name,
    now,
    formatTime: (ms) => formatTimeShort(ms, clock),
  });

  if (alerts.some((a) => a.kind === 'show') && Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: t('channel.family'), importance: Notifications.AndroidImportance.HIGH });
  }
  for (const a of alerts) {
    // Showing under the same id replaces "asleep" with "woke up".
    await Notifications.dismissNotificationAsync(a.id).catch(() => {});
    if (a.kind === 'show') {
      await Notifications.scheduleNotificationAsync({
        identifier: a.id,
        content: { title: a.title, body: a.body, data: { childId: a.childId } },
        trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
      });
    }
  }
}
