import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { addDays, formatHoursMinutes, sleepSegments, type DayStats, type LogEntry } from '@kindred-log/shared';
import { TYPE_META } from '../logTypes';
import { hourLabel } from './DayTimeline';

const ROW_H = 22;
const NAP = '#c4b5fd';
const NIGHT = '#7c3aed';

/**
 * Sleep pattern: one row per day across 24 h (like Baby Buddy / Huckleberry), sleep as
 * bars and milk feeds as ticks. Tapping a row opens that day.
 */
export default function WeekPattern({
  logs,
  stats,
  now,
  clock,
  onPressDay,
}: {
  logs: LogEntry[];
  stats: DayStats[];
  now: number;
  clock: '12h' | '24h';
  onPressDay: (day: number) => void;
}) {
  const feedColor = TYPE_META.feed.color;

  return (
    <View>
      <View className="ml-14 mr-14 mb-1 h-3">
        {[0, 6, 12, 18].map((h) => (
          <Text key={h} className="absolute text-slate-500 text-[10px]" style={{ left: `${(h / 24) * 100}%` }}>
            {hourLabel(h, clock)}
          </Text>
        ))}
      </View>
      {stats.map((s) => {
        const dayEnd = addDays(s.day, 1);
        const pct = (t: number) => `${((t - s.day) / (dayEnd - s.day)) * 100}%` as const;
        const segments = sleepSegments(logs, s.day, dayEnd, now);
        const feeds = logs.filter(
          (l) => l.payload.type === 'feed' && l.payload.method !== 'solids' && l.startedAt >= s.day && l.startedAt < dayEnd,
        );
        return (
          <Pressable key={s.day} onPress={() => onPressDay(s.day)} className="flex-row items-center mb-1.5">
            <Text className="w-14 text-slate-400 text-xs">
              {new Date(s.day).toLocaleDateString([], { weekday: 'short', day: 'numeric' })}
            </Text>
            <View className="flex-1 bg-slate-800/60 rounded overflow-hidden" style={{ height: ROW_H }}>
              {[6, 12, 18].map((h) => (
                <View key={h} className="absolute top-0 bottom-0 w-px bg-slate-700/70" style={{ left: `${(h / 24) * 100}%` }} />
              ))}
              {segments.map((seg) => (
                <View
                  key={seg.id}
                  className="absolute top-0 bottom-0"
                  style={{ left: pct(seg.start), width: pct(s.day + seg.end - seg.start), backgroundColor: seg.nap ? NAP : NIGHT }}
                />
              ))}
              {feeds.map((f) => (
                <View key={f.id} className="absolute bottom-0 h-2 w-0.5" style={{ left: pct(f.startedAt), backgroundColor: feedColor }} />
              ))}
            </View>
            <Text className="w-14 text-right text-slate-300 text-xs">{s.sleepMs > 0 ? formatHoursMinutes(s.sleepMs) : '–'}</Text>
          </Pressable>
        );
      })}
      <View className="flex-row gap-4 mt-2 ml-14">
        <Legend color={NIGHT} label="Night" />
        <Legend color={NAP} label="Nap" />
        <Legend color={feedColor} label="Feed" thin />
      </View>
    </View>
  );
}

function Legend({ color, label, thin }: { color: string; label: string; thin?: boolean }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View style={{ width: thin ? 3 : 10, height: 10, borderRadius: 2, backgroundColor: color }} />
      <Text className="text-slate-500 text-[11px]">{label}</Text>
    </View>
  );
}
