import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { addDays, isNap, type LogEntry, type LogType, type PayloadOf } from '@kindred-log/shared';
import { TYPE_META } from '../logTypes';
import { colors } from '../../theme/colors';

const HOUR_H = 32;
const DOT = 12;
const LANES: { key: string; label: string; types: LogType[] }[] = [
  { key: 'sleep', label: 'Sleep', types: ['sleep'] },
  { key: 'feed', label: 'Feed', types: ['feed', 'pumping'] },
  { key: 'diaper', label: 'Diaper', types: ['diaper', 'potty'] },
  { key: 'other', label: 'Other', types: ['activity', 'medication', 'temperature', 'growth', 'milestone', 'note'] },
];

export function hourLabel(h: number, clock: '12h' | '24h') {
  if (clock === '24h') return String(h % 24).padStart(2, '0');
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${h % 24 < 12 ? 'a' : 'p'}`;
}

/** One day as a vertical 24 h timeline with a lane per category. Tap an item to edit it. */
export default function DayTimeline({
  logs,
  day,
  now,
  clock,
}: {
  logs: LogEntry[];
  day: number;
  now: number;
  clock: '12h' | '24h';
}) {
  const dayEnd = addDays(day, 1);
  const height = 24 * HOUR_H;
  const y = (t: number) => ((Math.min(Math.max(t, day), dayEnd) - day) / (dayEnd - day)) * height;

  return (
    <View>
      <View className="flex-row ml-10 mb-1">
        {LANES.map((l) => (
          <Text key={l.key} className="flex-1 text-center text-ink-faint text-[11px]">{l.label}</Text>
        ))}
      </View>
      <View className="flex-row" style={{ height }}>
        <View className="w-10">
          {Array.from({ length: 9 }, (_, i) => i * 3).map((h) => (
            <Text key={h} className="absolute text-ink-faint text-[10px]" style={{ top: Math.min(h * HOUR_H - 6, height - 12) }}>
              {hourLabel(h, clock)}
            </Text>
          ))}
        </View>
        <View className="flex-1 flex-row">
          {Array.from({ length: 25 }, (_, h) => (
            <View key={h} className={`absolute left-0 right-0 h-px ${h % 6 === 0 ? 'bg-raised-high' : 'bg-raised/70'}`} style={{ top: Math.min(h * HOUR_H, height - 1) }} />
          ))}
          {LANES.map((lane) => (
            <View key={lane.key} className="flex-1 mx-1">
              {logs
                .filter((l) => lane.types.includes(l.logType))
                .map((l) => {
                  const meta = TYPE_META[l.logType];
                  const end = l.endedAt ?? now;
                  const top = y(l.startedAt);
                  const isBlock = end - l.startedAt >= 10 * 60_000;
                  const faded = l.logType === 'sleep' && isNap(l as LogEntry & { payload: PayloadOf<'sleep'> });
                  return (
                    <Pressable
                      key={l.id}
                      onPress={() => router.push(`/entry/${l.id}`)}
                      hitSlop={6}
                      className="absolute left-0 right-0 items-center"
                      style={{ top: isBlock ? top : top - DOT / 2, height: isBlock ? Math.max(4, y(end) - top) : DOT }}
                    >
                      {isBlock ? (
                        <View
                          className="w-full flex-1 rounded-md border"
                          style={{ backgroundColor: meta.color, opacity: faded ? 0.55 : 0.9, borderColor: l.endedAt === null ? colors.ink : 'transparent' }}
                        />
                      ) : (
                        <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: meta.color }} />
                      )}
                    </Pressable>
                  );
                })}
            </View>
          ))}
          {now >= day && now < dayEnd ? (
            <View className="absolute left-0 right-0 h-0.5 bg-red-strong" style={{ top: y(now) }} />
          ) : null}
        </View>
      </View>
    </View>
  );
}
