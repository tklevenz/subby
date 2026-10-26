import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AngleDown, AngleLeft, AngleRight } from '../../components/icons';
import CalendarSheet from '../../components/datetime/CalendarSheet';
import { addDays, dailyStats, dayRange, formatHoursMinutes, formatVolume, startOfDay, type DayStats } from '@kindred-log/shared';
import { DayLog, DayTotals } from '../../components/history/DayLog';
import WeekPattern from '../../components/charts/WeekPattern';
import { Segmented } from '../../components/ui';
import { useLogQuery } from '../../store/queries';
import { useSettingsStore } from '../../store/useSettingsStore';
import { formatDayLabel, useNow } from '../../store/timeHelpers';
import { colors } from '../../theme/colors';

type Mode = 'day' | 'week';
const MODES = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
] as const;

/** History: one day as a timeline (with wake windows), or a week of sleep patterns and totals. */
export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('day');
  const [anchor, setAnchor] = useState(() => startOfDay(Date.now()));

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between mx-4 mt-2 mb-2">
        <Text className="text-xl font-bold text-ink">History</Text>
        <Segmented options={MODES} value={mode} onChange={setMode} />
      </View>
      <Calendar
        mode={mode}
        anchor={anchor}
        setAnchor={setAnchor}
        openDay={(day) => {
          setAnchor(day);
          setMode('day');
        }}
      />
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
  // A day also reads the two before it: last night's sleep and the sleep before the first wake window.
  const logs = useLogQuery({ from: addDays(days[0]!, mode === 'day' ? -2 : 0), to: addDays(anchor, 1) });
  const stats = useMemo(() => (logs ? dailyStats(logs, days, now) : null), [logs, days, now]);
  const [picking, setPicking] = useState(false);

  const short = (ms: number) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short' });
  const title = mode === 'day' ? formatDayLabel(anchor, now) : `${short(days[0]!)} – ${short(anchor)}`;
  // Under "Today" or "Yesterday", the date itself.
  const subtitle =
    mode === 'day' && anchor >= addDays(today, -1)
      ? new Date(anchor).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
      : null;

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
      <View className="flex-row items-center justify-between my-2">
        <NavButton icon={<AngleLeft color={colors.inkSoft} size={20} />} onPress={() => setAnchor(addDays(anchor, -span))} />
        <View className="items-center">
          {/* The date opens a month calendar to jump to any day. */}
          <Pressable
            onPress={() => setPicking(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${title}, pick a day`}
            className="flex-row items-center"
          >
            <Text className="text-ink font-semibold text-base">{title}</Text>
            <AngleDown color={colors.inkFaint} size={12} style={{ marginLeft: 6 }} />
          </Pressable>
          {anchor === today ? (
            subtitle ? <Text className="text-ink-muted text-xs">{subtitle}</Text> : null
          ) : (
            <Pressable onPress={() => setAnchor(today)} hitSlop={8}>
              <Text className="text-violet-soft text-xs font-semibold">Back to today</Text>
            </Pressable>
          )}
        </View>
        <NavButton
          icon={<AngleRight color={anchor >= today ? colors.lineStrong : colors.inkSoft} size={20} />}
          disabled={anchor >= today}
          onPress={() => setAnchor(Math.min(addDays(anchor, span), today))}
        />
      </View>

      {!logs || !stats ? null : mode === 'day' ? (
        <>
          <DayTotals stats={stats[0]!} units={units} />
          <View className="mt-2.5">
            <DayLog logs={logs} day={anchor} now={now} />
          </View>
        </>
      ) : (
        <>
          <WeekPattern logs={logs} stats={[...stats].reverse()} now={now} clock={clock} onPressDay={openDay} />
          <WeekTable stats={stats} units={units} />
        </>
      )}
      {picking ? (
        <CalendarSheet
          value={anchor}
          onClose={() => setPicking(false)}
          onPick={(day) => {
            setPicking(false);
            setAnchor(day);
          }}
        />
      ) : null}
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
