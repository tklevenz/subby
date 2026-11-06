import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Switch, Text, View } from 'react-native';
import { FORGOTTEN_TIMER_MIN, type ReminderSettings } from '@kindred-log/shared';
import { Card, Segmented } from '../components/ui';
import {
  notificationsAllowed,
  remindersAvailable,
  requestNotifications,
  setRemindersEnabled,
  upcomingReminders,
} from '../features/reminders/scheduler';
import { useSettingsStore } from '../store/useSettingsStore';
import { formatDayLabel, useFormatTime } from '../store/timeHelpers';
import { ScreenScroll } from '../components/ScreenScroll';

type Interval = { value: string; label: string };
const FEED_INTERVALS: Interval[] = [
  { value: '120', label: '2h' },
  { value: '150', label: '2.5h' },
  { value: '180', label: '3h' },
  { value: '210', label: '3.5h' },
  { value: '240', label: '4h' },
];
const DIAPER_INTERVALS: Interval[] = [
  { value: '120', label: '2h' },
  { value: '180', label: '3h' },
  { value: '240', label: '4h' },
];
const PUMP_INTERVALS: Interval[] = [
  { value: '120', label: '2h' },
  { value: '180', label: '3h' },
  { value: '240', label: '4h' },
  { value: '300', label: '5h' },
];

const NAP_LEADS = [
  { value: '0', label: 'At window start' },
  { value: '10', label: '10 min before' },
  { value: '20', label: '20 min before' },
] as const;

export default function RemindersScreen() {
  const reminders = useSettingsStore((s) => s.reminders);
  const setSetting = useSettingsStore((s) => s.set);
  const formatTime = useFormatTime();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [upcoming, setUpcoming] = useState<Awaited<ReturnType<typeof upcomingReminders>>>([]);

  const refresh = useCallback(() => {
    notificationsAllowed().then(setAllowed);
    // The scheduler re-plans ~1 s after a change.
    setTimeout(() => upcomingReminders().then(setUpcoming), 1500);
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh, reminders]);

  const update = async (patch: Partial<ReminderSettings>, enabling: boolean) => {
    if (enabling && !(await requestNotifications())) {
      setAllowed(false);
      return;
    }
    await setSetting('reminders', { ...reminders, ...patch });
  };

  return (
    <ScreenScroll className="flex-1 bg-ground" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {!remindersAvailable ? (
        <View className="rounded-xl border border-amber/40 bg-amber/10 p-3 mb-4">
          <Text className="text-amber-pale text-sm leading-5">
            Reminders can't run in Expo Go on Android. They work in the iOS Expo Go app and in development builds.
          </Text>
        </View>
      ) : allowed === false ? (
        <View className="rounded-xl border border-amber/40 bg-amber/10 p-3 mb-4">
          <Text className="text-amber-pale text-sm leading-5">
            Notifications are turned off for Subby.{' '}
            <Text className="underline" onPress={() => Linking.openSettings()}>Open Settings</Text> to allow them.
          </Text>
        </View>
      ) : null}

      <View className="bg-surface border border-line rounded-2xl p-4 mb-5 flex-row items-center">
        <View className="flex-1 pr-3">
          <Text className="text-ink text-base font-semibold">Allow reminders</Text>
          <Text className="text-ink-muted text-xs mt-1 leading-4">Turn off to pause them all; your choices below are kept.</Text>
        </View>
        <Switch value={reminders.enabled} onValueChange={(on) => setRemindersEnabled(on).then(refresh)} disabled={!remindersAvailable} />
      </View>

      <View style={{ opacity: reminders.enabled ? 1 : 0.5 }}>
        <IntervalSection
          title="Feeding"
          description="When it's been this long since the last feed started."
          value={reminders.feed}
          options={FEED_INTERVALS}
          onChange={(feed, enabling) => update({ feed }, enabling)}
        />
        <IntervalSection
          title="Diaper"
          description="When it's been this long since the last diaper change."
          value={reminders.diaper}
          options={DIAPER_INTERVALS}
          onChange={(diaper, enabling) => update({ diaper }, enabling)}
        />
        <IntervalSection
          title="Pumping"
          description="When it's been this long since the last pumping session started."
          value={reminders.pumping}
          options={PUMP_INTERVALS}
          onChange={(pumping, enabling) => update({ pumping }, enabling)}
        />

        <Section
          title="Medication"
          description="When the next dose is due, for medications logged with a dosing interval."
          enabled={reminders.medication.enabled}
          onToggle={(on) => update({ medication: { enabled: on } }, on)}
        />

        <Section
          title="Nap & bedtime"
          description="Before the predicted sleep window, from the baby's age and last 7 days."
          enabled={reminders.nap.enabled}
          onToggle={(on) => update({ nap: { ...reminders.nap, enabled: on } }, on)}
        >
          <Segmented
            options={NAP_LEADS}
            value={String(reminders.nap.leadMin) as (typeof NAP_LEADS)[number]['value']}
            onChange={(v) => update({ nap: { ...reminders.nap, leadMin: Number(v) } }, false)}
          />
        </Section>

        <Section
          title="Forgotten timers"
          description={`Asks whether a timer is still going: feeds after ${FORGOTTEN_TIMER_MIN.feed} min, pumping after ${FORGOTTEN_TIMER_MIN.pumping} min, naps after ${FORGOTTEN_TIMER_MIN.nap / 60} h, night sleep after ${FORGOTTEN_TIMER_MIN.night / 60} h.`}
          enabled={reminders.timers.enabled}
          onToggle={(on) => update({ timers: { enabled: on } }, on)}
        />
      </View>

      <Text className="text-xs font-semibold text-ink-muted uppercase mt-6 mb-2 ml-1">Coming up</Text>
      <Card>
        {upcoming.length === 0 ? (
          <Text className="text-ink-faint px-4 py-3.5">No reminders scheduled.</Text>
        ) : (
          upcoming.map((u) => (
            <View key={u.id} className="flex-row px-4 py-3 border-b border-line">
              <Text className="flex-1 text-ink">{u.title}</Text>
              {u.at ? <Text className="text-ink-muted">{formatDayLabel(u.at)} {formatTime(u.at)}</Text> : null}
            </View>
          ))
        )}
      </Card>
      <Text className="text-ink-ghost text-xs mt-3 leading-5">
        Reminders are set on this phone only and move automatically as you log.
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
  options: Interval[];
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
        <Switch value={enabled} onValueChange={onToggle} disabled={!remindersAvailable} />
      </View>
      {enabled && children ? <View className="mt-3">{children}</View> : null}
    </View>
  );
}
