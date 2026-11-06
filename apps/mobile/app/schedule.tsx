import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { CloudSun, Moon, Sun } from '../components/icons';
import {
  addDays,
  formatHoursMinutes,
  predictNextSleep,
  startOfDay,
  suggestedSchedule,
  type ScheduleItem,
} from '@kindred-log/shared';
import { useLogQuery } from '../store/queries';
import { useActiveChild } from '../store/useActiveChild';
import { useFormatTime, useNow } from '../store/timeHelpers';
import { colors } from '../theme/colors';
import { ScreenScroll } from '../components/ScreenScroll';

const SLEEP = ['sleep'] as const;

export default function ScheduleScreen() {
  const child = useActiveChild();
  const now = useNow(60_000);
  const formatTime = useFormatTime();
  const logs = useLogQuery({ from: addDays(startOfDay(now), -8), types: SLEEP });

  const data = useMemo(() => {
    if (!logs || !child) return null;
    return { next: predictNextSleep(logs, child, now), schedule: suggestedSchedule(logs, child, now) };
  }, [logs, child, now]);

  if (!child || !data) return null;
  const { next, schedule } = data;
  const asleep = logs?.some((l) => l.endedAt === null);
  const { norms } = schedule;

  return (
    <ScreenScroll className="flex-1 bg-ground" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View className="bg-violet/10 border border-violet/40 rounded-2xl p-4">
        <Text className="text-violet-pale text-xs font-medium">
          {next ? (next.kind === 'bedtime' ? 'Bedtime' : `Next nap`) : 'Next sleep'}
        </Text>
        {next ? (
          <>
            {/* The likely time, then the window to put down in; the suggested day below shows the nap itself. */}
            <Text className="text-ink text-2xl font-semibold mt-1">around {formatTime((next.earliest + next.latest) / 2)}</Text>
            <Text className="text-ink-soft text-sm mt-0.5">
              between {formatTime(next.earliest)} and {formatTime(next.latest)}
            </Text>
            <Text className="text-ink-muted text-xs mt-1">
              Awake since {formatTime(next.wakeAt)} ·{' '}
              {next.basis === 'personal' ? `based on ${child.name}'s last 7 days` : 'based on typical wake windows for this age'}
            </Text>
          </>
        ) : (
          <Text className="text-ink-soft mt-1">
            {asleep ? `${child.name} is asleep.` : 'Log a sleep to get a prediction for the next one.'}
          </Text>
        )}
      </View>

      <Text className="text-xs font-semibold text-ink-muted uppercase mt-6 mb-2 ml-1">Suggested day</Text>
      <View className="bg-surface border border-line rounded-2xl px-4 py-1">
        {schedule.items.map((item, i) => (
          <ItemRow key={i} item={item} now={now} formatTime={formatTime} />
        ))}
      </View>

      <Text className="text-ink-faint text-xs mt-4 leading-5">
        Typical at this age: {norms.naps} nap{norms.naps === 1 ? '' : 's'} a day, awake{' '}
        {formatHoursMinutes(norms.wakeMin * 60_000)}–{formatHoursMinutes(norms.wakeMax * 60_000)} between sleeps.{' '}
        {schedule.basis === 'personal'
          ? `Adjusted towards ${child.name}'s own rhythm from the last 7 days.`
          : 'Log a few days of sleep to personalize this.'}
      </Text>
      <Text className="text-ink-ghost text-xs mt-2 leading-5">
        Estimates only. Follow your baby's sleepy cues, and talk to your pediatrician about sleep concerns.
      </Text>
    </ScreenScroll>
  );
}

/** A nap length to the nearest 5 minutes: "1h", "1h 25m", "45m". */
function roughLength(ms: number) {
  const min = Math.round(ms / 300_000) * 5;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function ItemRow({ item, now, formatTime }: { item: ScheduleItem; now: number; formatTime: (ms: number) => string }) {
  const end = item.kind === 'nap' ? item.end : item.at;
  // Predictions that have passed fade; what was logged stays.
  const past = !item.logged && end < now;
  const [icon, label, time] =
    item.kind === 'wake'
      ? [<Sun key="i" color={colors.amberSoft} size={16} />, 'Wake up', formatTime(item.at)]
      : item.kind === 'nap'
        ? [
            <CloudSun key="i" color={colors.violetSoft} size={16} />,
            `Nap ${item.index + 1}`,
            // A predicted nap shows its start (its length goes below); a logged one, its actual times.
            item.running ? `since ${formatTime(item.start)}` : item.logged ? `${formatTime(item.start)} – ${formatTime(item.end)}` : formatTime(item.start),
          ]
        : [<Moon key="i" color={colors.violetDeep} size={16} />, 'Bedtime', formatTime(item.at)];
  return (
    <View className={`flex-row items-center py-3 border-b border-line ${past ? 'opacity-40' : ''}`}>
      {icon}
      <View className="flex-1 ml-3">
        <Text className="text-ink">{label}</Text>
        {item.logged ? (
          <Text className="text-ink-faint text-xs">{item.kind === 'nap' && item.running ? 'Napping now' : 'Logged'}</Text>
        ) : item.kind === 'nap' ? (
          <Text className="text-ink-faint text-xs">about {roughLength(item.end - item.start)}</Text>
        ) : null}
      </View>
      <Text className="text-ink-soft">{time}</Text>
    </View>
  );
}
