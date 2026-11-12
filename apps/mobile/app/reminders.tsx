import { t } from '@subby/shared/i18n';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Text, View } from 'react-native';
import { FORGOTTEN_TIMER_MIN, activeReminderCount, type ReminderSettings } from '@subby/shared';
import { Card, Segmented, Toggle, SectionLabel, Notice } from '../components/ui';
import {
  notificationsBlocked,
  remindersAvailable,
  replanReminders,
  requestNotifications,
  setRemindersEnabled,
  upcomingReminders,
} from '../features/reminders/scheduler';
import { useSettingsStore } from '../store/useSettingsStore';
import { formatDayLabel, useFormatTime } from '../store/timeHelpers';
import { ScreenScroll } from '../components/ScreenScroll';

/** Interval choices in hours (the values are minutes). */
const intervals = (hours: number[]) => hours.map((h) => ({ value: String(h * 60), label: t('reminders.hours', { h }) }));
const feedIntervals = () => intervals([2, 2.5, 3, 3.5, 4]);
const diaperIntervals = () => intervals([2, 3, 4]);
const pumpIntervals = () => intervals([2, 3, 4, 5]);

const napLeads = () =>
  [
    { value: '0', label: t('reminders.atStart') },
    { value: '10', label: t('reminders.before', { count: 10 }) },
    { value: '20', label: t('reminders.before', { count: 20 }) },
  ] as const;

export default function RemindersScreen() {
  const reminders = useSettingsStore((s) => s.reminders);
  const setSetting = useSettingsStore((s) => s.set);
  const formatTime = useFormatTime();
  const anySet = activeReminderCount({ ...reminders, enabled: true }) > 0;
  // Only once the phone won't ask again: before the first switch, it simply asks.
  const [blocked, setBlocked] = useState(false);
  const [upcoming, setUpcoming] = useState<Awaited<ReturnType<typeof upcomingReminders>>>([]);

  const refresh = useCallback(() => {
    void notificationsBlocked().then(setBlocked);
    void upcomingReminders().then(setUpcoming);
  }, []);
  // After a change: plan now (not on the scheduler's own debounce), then show what got planned.
  const replanAndRefresh = async () => {
    await replanReminders();
    refresh();
  };

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const update = async (patch: Partial<ReminderSettings>, enabling: boolean) => {
    if (enabling && !(await requestNotifications())) {
      setBlocked(true); // just denied: say where to allow them
      return;
    }
    await setSetting('reminders', { ...reminders, ...patch });
    await replanAndRefresh();
  };

  return (
    <ScreenScroll>
      {!remindersAvailable ? (
        <Notice className="mb-4">
          <Text className="text-amber-pale text-sm leading-5">
            {t('reminders.expoGo')}
          </Text>
        </Notice>
      ) : blocked ? (
        <Notice className="mb-4">
          <Text className="text-amber-pale text-sm leading-5">
            {t('reminders.off')}{' '}
            <Text className="underline" onPress={() => Linking.openSettings()}>
              {t('reminders.openSettings')}
            </Text>
            {t('reminders.toAllow')}
          </Text>
        </Notice>
      ) : null}

      {/* Pausing only means something once a reminder is set up. */}
      {anySet ? (
        <View className="bg-surface border border-line rounded-2xl p-4 mb-5 flex-row items-center">
          <View className="flex-1 pr-3">
            <Text className="text-ink text-base font-semibold">{t('reminders.allow')}</Text>
            <Text className="text-ink-muted text-xs mt-1 leading-4">{t('reminders.allowHint')}</Text>
          </View>
          <Toggle value={reminders.enabled} onValueChange={(on) => setRemindersEnabled(on).then(replanAndRefresh)} disabled={!remindersAvailable} />
        </View>
      ) : null}

      <View style={{ opacity: reminders.enabled || !anySet ? 1 : 0.5 }}>
        <IntervalSection
          title={t('reminders.feeding')}
          description={t('reminders.feedingText')}
          value={reminders.feed}
          options={feedIntervals()}
          onChange={(feed, enabling) => update({ feed }, enabling)}
        />
        <IntervalSection
          title={t('reminders.diaper')}
          description={t('reminders.diaperText')}
          value={reminders.diaper}
          options={diaperIntervals()}
          onChange={(diaper, enabling) => update({ diaper }, enabling)}
        />
        <IntervalSection
          title={t('reminders.pumping')}
          description={t('reminders.pumpingText')}
          value={reminders.pumping}
          options={pumpIntervals()}
          onChange={(pumping, enabling) => update({ pumping }, enabling)}
        />

        <Section
          title={t('reminders.medication')}
          description={t('reminders.medicationText')}
          enabled={reminders.medication.enabled}
          onToggle={(on) => update({ medication: { enabled: on } }, on)}
        />

        <Section
          title={t('reminders.nap')}
          description={t('reminders.napText')}
          enabled={reminders.nap.enabled}
          onToggle={(on) => update({ nap: { ...reminders.nap, enabled: on } }, on)}
        >
          <Segmented
            options={napLeads()}
            value={String(reminders.nap.leadMin) as ReturnType<typeof napLeads>[number]['value']}
            onChange={(v) => update({ nap: { ...reminders.nap, leadMin: Number(v) } }, false)}
          />
        </Section>

        <Section
          title={t('reminders.timers')}
          description={t('reminders.timersText', {
            feed: FORGOTTEN_TIMER_MIN.feed!,
            pumping: FORGOTTEN_TIMER_MIN.pumping!,
            nap: FORGOTTEN_TIMER_MIN.nap / 60,
            night: FORGOTTEN_TIMER_MIN.night / 60,
          })}
          enabled={reminders.timers.enabled}
          onToggle={(on) => update({ timers: { enabled: on } }, on)}
        />
      </View>

      <SectionLabel>{t('reminders.comingUp')}</SectionLabel>
      <Card>
        {upcoming.length === 0 ? (
          <Text className="text-ink-faint px-4 py-3.5">{t('reminders.none')}</Text>
        ) : (
          upcoming.map((u) => (
            <View key={u.id} className="flex-row px-4 py-3 border-b border-line">
              <Text className="flex-1 text-ink">{u.title}</Text>
              {u.at ? <Text className="text-ink-muted">{t('reminders.when', { day: formatDayLabel(u.at), time: formatTime(u.at) })}</Text> : null}
            </View>
          ))
        )}
      </Card>
      <Text className="text-ink-ghost text-xs mt-3 leading-5">
        {t('reminders.footer')}
      </Text>
    </ScreenScroll>
  );
}

function IntervalSection({
  title,
  description,
  value,
  options,
  onChange,
}: {
  title: string;
  description: string;
  value: { enabled: boolean; intervalMin: number };
  options: ReturnType<typeof intervals>;
  onChange: (value: { enabled: boolean; intervalMin: number }, enabling: boolean) => void;
}) {
  return (
    <Section title={title} description={description} enabled={value.enabled} onToggle={(on) => onChange({ ...value, enabled: on }, on)}>
      <Segmented options={options} value={String(value.intervalMin)} onChange={(v) => onChange({ ...value, intervalMin: Number(v) }, false)} />
    </Section>
  );
}

function Section({
  title,
  description,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <View className="bg-surface border border-line rounded-2xl p-4 mb-3">
      <View className="flex-row items-center">
        <View className="flex-1 pr-3">
          <Text className="text-ink text-base font-semibold">{title}</Text>
          <Text className="text-ink-muted text-xs mt-1 leading-4">{description}</Text>
        </View>
        <Toggle value={enabled} onValueChange={onToggle} disabled={!remindersAvailable} />
      </View>
      {enabled && children ? <View className="mt-3">{children}</View> : null}
    </View>
  );
}
