import React, { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Moon, Sun, SunMedium } from 'lucide-react-native';
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
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View className="bg-violet-500/10 border border-violet-500/40 rounded-2xl p-4">
        <Text className="text-violet-200 text-xs font-medium">
          {next ? (next.kind === 'bedtime' ? 'Bedtime' : `Next nap`) : 'Next sleep'}
        </Text>
        {next ? (
          <>
            <Text className="text-white text-2xl font-semibold mt-1">
              {formatTime(next.earliest)} – {formatTime(next.latest)}
            </Text>
            <Text className="text-slate-400 text-xs mt-1">
              Awake since {formatTime(next.wakeAt)} ·{' '}
              {next.basis === 'personal' ? `based on ${child.name}'s last 7 days` : 'based on typical wake windows for this age'}
            </Text>
          </>
        ) : (
          <Text className="text-slate-300 mt-1">
            {asleep ? `${child.name} is asleep.` : 'Log a sleep to get a prediction for the next one.'}
          </Text>
        )}
      </View>

      <Text className="text-xs font-semibold text-slate-400 uppercase mt-6 mb-2 ml-1">Suggested day</Text>
      <View className="bg-slate-900 border border-slate-800 rounded-2xl px-4 py-1">
        {schedule.items.map((item, i) => (
          <ItemRow key={i} item={item} now={now} formatTime={formatTime} />
        ))}
      </View>

      <Text className="text-slate-500 text-xs mt-4 leading-5">
        Typical at this age: {norms.naps} nap{norms.naps === 1 ? '' : 's'} a day, awake{' '}
        {formatHoursMinutes(norms.wakeMin * 60_000)}–{formatHoursMinutes(norms.wakeMax * 60_000)} between sleeps.{' '}
        {schedule.basis === 'personal'
          ? `Adjusted towards ${child.name}'s own rhythm from the last 7 days.`
          : 'Log a few days of sleep to personalize this.'}
      </Text>
      <Text className="text-slate-600 text-xs mt-2 leading-5">
        Estimates only. Follow your baby's sleepy cues, and talk to your pediatrician about sleep concerns.
      </Text>
    </ScrollView>
  );
}

function ItemRow({ item, now, formatTime }: { item: ScheduleItem; now: number; formatTime: (ms: number) => string }) {
  const end = item.kind === 'nap' ? item.end : item.at;
  const past = end < now;
  const [icon, label, time] =
    item.kind === 'wake'
      ? [<Sun key="i" color="#fcd34d" size={16} />, 'Wake up', formatTime(item.at)]
      : item.kind === 'nap'
        ? [<SunMedium key="i" color="#c4b5fd" size={16} />, `Nap ${item.index + 1}`, `${formatTime(item.start)} – ${formatTime(item.end)}`]
        : [<Moon key="i" color="#7c3aed" size={16} />, 'Bedtime', formatTime(item.at)];
  return (
    <View className={`flex-row items-center py-3 border-b border-slate-800 ${past ? 'opacity-40' : ''}`}>
      {icon}
      <Text className="flex-1 text-white ml-3">{label}</Text>
      <Text className="text-slate-300">{time}</Text>
    </View>
  );
}
