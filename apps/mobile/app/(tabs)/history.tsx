import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AngleLeft, AngleRight } from '../../components/icons';
import { addDays, dailyStats, dayRange, formatHoursMinutes, formatVolume, startOfDay, type DayStats } from '@kindred-log/shared';
import LogTimeline from '../../components/LogTimeline';
import DayTimeline from '../../components/charts/DayTimeline';
import WeekPattern from '../../components/charts/WeekPattern';
import { Segmented } from '../../components/ui';
import { useLogQuery } from '../../store/queries';
import { useLogStore } from '../../store/useLogStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { formatDayLabel, useNow } from '../../store/timeHelpers';
import { colors } from '../../theme/colors';

type Mode = 'list' | 'day' | 'week';
const MODES = [
  { value: 'list', label: 'List' },
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
] as const;

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const loadOlder = useLogStore((s) => s.loadOlder);
  const [mode, setMode] = useState<Mode>('list');
  const [anchor, setAnchor] = useState(() => startOfDay(Date.now()));

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between mx-4 mt-2 mb-2">
        <Text className="text-xl font-bold text-ink">History</Text>
        <Segmented options={MODES} value={mode} onChange={setMode} />
      </View>
      {mode === 'list' ? (
        <LogTimeline onEndReached={loadOlder} />
      ) : (
        <Calendar
          mode={mode}
          anchor={anchor}
          setAnchor={setAnchor}
          openDay={(day) => {
            setAnchor(day);
            setMode('day');
          }}
        />
      )}
    </View>
  );
}

function Calendar({
  mode,
  anchor,
  setAnchor,
  openDay,
}: {
  mode: 'day' | 'week';
  anchor: number;
  setAnchor: (day: number) => void;
  openDay: (day: number) => void;
}) {
  const now = useNow(60_000);
  const clock = useSettingsStore((s) => s.clock);
  const units = useSettingsStore((s) => s.units);
  const today = startOfDay(now);
  const span = mode === 'day' ? 1 : 7;
  const days = useMemo(() => dayRange(anchor, span), [anchor, span]);
  const logs = useLogQuery({ from: days[0], to: addDays(anchor, 1) });
  const stats = useMemo(() => (logs ? dailyStats(logs, days, now) : null), [logs, days, now]);

  const title =
    mode === 'day'
      ? formatDayLabel(anchor, now)
      : `${new Date(days[0]).toLocaleDateString([], { day: 'numeric', month: 'short' })} – ${new Date(anchor).toLocaleDateString([], { day: 'numeric', month: 'short' })}`;

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
      <View className="flex-row items-center justify-between my-2">
        <NavButton icon={<AngleLeft color={colors.inkSoft} size={20} />} onPress={() => setAnchor(addDays(anchor, -span))} />
        <Pressable onPress={() => setAnchor(today)} disabled={anchor === today}>
          <Text className="text-ink font-semibold text-base">{title}</Text>
        </Pressable>
        <NavButton
          icon={<AngleRight color={anchor >= today ? colors.lineStrong : colors.inkSoft} size={20} />}
          disabled={anchor >= today}
          onPress={() => setAnchor(Math.min(addDays(anchor, span), today))}
        />
      </View>

      {!logs || !stats ? null : mode === 'day' ? (
        <>
          <Totals stats={stats[0]} units={units} />
          <View className="mt-4">
            <DayTimeline logs={logs} day={anchor} now={now} clock={clock} />
          </View>
          {!stats[0].tracked && stats[0].sleepMs === 0 ? (
            <Text className="text-ink-faint text-center mt-4">Nothing logged this day.</Text>
          ) : null}
        </>
      ) : (
        <>
          <WeekPattern logs={logs} stats={[...stats].reverse()} now={now} clock={clock} onPressDay={openDay} />
          <WeekTable stats={stats} units={units} />
        </>
      )}
    </ScrollView>
  );
}

function NavButton({ icon, onPress, disabled }: { icon: React.ReactNode; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={10} className="w-9 h-9 rounded-full bg-surface items-center justify-center">
      {icon}
    </Pressable>
  );
}

function Totals({ stats, units }: { stats: DayStats; units: 'metric' | 'imperial' }) {
  const items = [
    { label: 'Sleep', value: formatHoursMinutes(stats.sleepMs), sub: stats.naps ? `${stats.naps} nap${stats.naps === 1 ? '' : 's'}` : undefined },
    { label: 'Feeds', value: String(stats.feeds), sub: stats.bottleMl ? formatVolume(stats.bottleMl, units) : stats.breastSec ? formatHoursMinutes(stats.breastSec * 1000) : undefined },
    { label: 'Diapers', value: String(stats.diapers), sub: stats.diapers ? `${stats.wet} wet · ${stats.dirty} dirty` : undefined },
  ];
  return (
    <View className="flex-row gap-2">
      {items.map((i) => (
        <View key={i.label} className="flex-1 bg-surface border border-line rounded-xl p-3">
          <Text className="text-ink-muted text-xs">{i.label}</Text>
          <Text className="text-ink text-lg font-semibold">{i.value}</Text>
          {i.sub ? <Text className="text-ink-faint text-[11px]" numberOfLines={1}>{i.sub}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function WeekTable({ stats, units }: { stats: DayStats[]; units: 'metric' | 'imperial' }) {
  const showBottle = stats.some((s) => s.bottleMl > 0);
  const cols = ['Day', 'Sleep', 'Naps', 'Feeds', ...(showBottle ? ['Bottle'] : []), 'Diapers'];
  return (
    <View className="mt-6 bg-surface border border-line rounded-2xl px-3 py-2">
      <View className="flex-row py-1.5 border-b border-line">
        {cols.map((c, i) => (
          <Text key={c} className={`flex-1 text-ink-faint text-[11px] ${i ? 'text-right' : ''}`}>{c}</Text>
        ))}
      </View>
      {[...stats].reverse().map((s) => (
        <View key={s.day} className="flex-row py-1.5">
          <Text className="flex-1 text-ink-muted text-xs">{new Date(s.day).toLocaleDateString([], { weekday: 'short' })}</Text>
          <Cell>{s.sleepMs ? formatHoursMinutes(s.sleepMs) : '–'}</Cell>
          <Cell>{s.naps || '–'}</Cell>
          <Cell>{s.feeds || '–'}</Cell>
          {showBottle ? <Cell>{s.bottleMl ? formatVolume(s.bottleMl, units) : '–'}</Cell> : null}
          <Cell>{s.diapers || '–'}</Cell>
        </View>
      ))}
    </View>
  );
}

const Cell = ({ children }: { children: React.ReactNode }) => (
  <Text className="flex-1 text-right text-ink-light text-xs">{children}</Text>
);
