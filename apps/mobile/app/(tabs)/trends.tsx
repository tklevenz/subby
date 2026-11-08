import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AngleRight } from '../../components/icons';
import {
  addDays,
  averageNights,
  averageStats,
  dailyStats,
  dayRange,
  formatHoursMinutes,
  formatVolume,
  groupNights,
  mlToOz,
  nightsByDay,
  startOfDay,
  type DayStats,
} from '@subby/shared';
import BarChart, { type Bar } from '../../components/charts/BarChart';
import { TYPE_META } from '../../components/logTypes';
import { Card, Row, Segmented } from '../../components/ui';
import { useLogQuery } from '../../store/queries';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useNow } from '../../store/timeHelpers';
import { colors } from '../../theme/colors';
import { EmptyState } from '../../components/brand/EmptyState';

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
] as const;

const H = 3_600_000;

export default function TrendsScreen() {
  const insets = useSafeAreaInsets();
  const now = useNow(60_000);
  const units = useSettingsStore((s) => s.units);
  const [range, setRange] = useState<(typeof RANGES)[number]['value']>('7');
  const count = Number(range);
  const today = startOfDay(now);
  const days = useMemo(() => dayRange(today, count), [today, count]);
  // From the day before: the first day's night started the evening before.
  const logs = useLogQuery({ from: addDays(days[0]!, -1), to: addDays(today, 1) });
  const stats = useMemo(() => (logs ? dailyStats(logs, days, now) : null), [logs, days, now]);
  // Today is still in progress: drawn faded and left out of the averages.
  const avg = useMemo(() => (stats ? averageStats(stats.slice(0, -1)) : null), [stats]);
  // Each day's night is the one that ended that morning, so today's counts once it's over.
  const nights = useMemo(() => (logs ? nightsByDay(groupNights(logs, now), days) : null), [logs, days, now]);
  const avgNight = useMemo(() => (nights ? averageNights(nights) : null), [nights]);
  const chevron = <AngleRight color={colors.inkGhost} size={16} />;

  const bars = (values: (s: DayStats) => number[]): Bar[] =>
    (stats ?? []).map((s) => ({
      label: count <= 7 ? new Date(s.day).toLocaleDateString([], { weekday: 'narrow' }) : String(new Date(s.day).getDate()),
      values: values(s),
      dim: s.day === today,
    }));

  const nightBars = (value: (n: NonNullable<NonNullable<typeof nights>[number]>) => number): Bar[] =>
    days.map((day, i) => ({
      label: count <= 7 ? new Date(day).toLocaleDateString([], { weekday: 'narrow' }) : String(new Date(day).getDate()),
      values: [nights?.[i] ? value(nights[i]!) : 0],
    }));

  const volume = (ml: number) => (units === 'metric' ? ml : mlToOz(ml));
  const any = (k: keyof DayStats) => stats?.some((s) => (s[k] as number) > 0) ?? false;

  return (
    <ScrollView className="flex-1 bg-ground" contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: 32 }}>
      <Text className="text-xl font-bold text-ink mt-2 mb-3">Trends</Text>
      <Segmented options={RANGES} value={range} onChange={setRange} />

      {stats && avg ? (
        avg.days === 0 && !stats[stats.length - 1].tracked ? (
          <EmptyState small text="Nothing logged in this period yet." />
        ) : (
          <>
            {any('sleepMs') ? (
              <Section
                title="Sleep"
                color={TYPE_META.sleep.color}
                stats={[
                  ['Per day', formatHoursMinutes(avg.sleepMs)],
                  ['Night', formatHoursMinutes(avg.nightMs)],
                  ['Naps', `${avg.naps.toFixed(1)} · ${formatHoursMinutes(avg.napMs)}`],
                ]}
              >
                <BarChart
                  bars={bars((s) => [s.nightMs / H, s.napMs / H])}
                  colors={[colors.violetDeep, colors.violetSoft]}
                  average={avg.sleepMs / H}
                  formatValue={(v) => `${v}h`}
                />
              </Section>
            ) : null}

            {/* Only once wakings are logged: without them, a night's longest stretch is just the night. */}
            {avgNight && nights?.some((n) => n && n.wakings > 0) ? (
              <Section
                title="Nights"
                color={colors.violetDeep}
                stats={[
                  ['Asleep', formatHoursMinutes(avgNight.asleepMs)],
                  ['Wakings', avgNight.wakings.toFixed(1)],
                  ['Longest stretch', formatHoursMinutes(avgNight.longestMs)],
                  ['Awake', formatHoursMinutes(avgNight.awakeMs)],
                ]}
              >
                <Text className="text-ink-muted text-xs mb-1">Wakings</Text>
                <BarChart bars={nightBars((n) => n.wakings)} colors={[colors.amberPale]} average={avgNight.wakings} />
                <View className="mt-4">
                  <Text className="text-ink-muted text-xs mb-1">Longest stretch</Text>
                  <BarChart
                    bars={nightBars((n) => n.longestMs / H)}
                    colors={[colors.violetDeep]}
                    average={avgNight.longestMs / H}
                    formatValue={(v) => `${v}h`}
                  />
                </View>
              </Section>
            ) : null}

            {any('feeds') || any('solids') ? (
              <Section
                title="Feeding"
                color={TYPE_META.feed.color}
                stats={[
                  ['Feeds / day', avg.feeds.toFixed(1)],
                  ...(any('bottleMl') ? [['Bottle / day', formatVolume(avg.bottleMl, units)] as [string, string]] : []),
                  ...(any('breastSec') ? [['Breast / day', formatHoursMinutes(avg.breastSec * 1000)] as [string, string]] : []),
                  ...(any('solids') ? [['Solids / day', avg.solids.toFixed(1)] as [string, string]] : []),
                ]}
              >
                <BarChart bars={bars((s) => [s.feeds, s.solids])} colors={[TYPE_META.feed.color, colors.amberPale]} average={avg.feeds} />
                {any('bottleMl') ? (
                  <View className="mt-4">
                    <Text className="text-ink-muted text-xs mb-1">Bottle volume</Text>
                    <BarChart
                      bars={bars((s) => [volume(s.bottleMl)])}
                      colors={[colors.cyanStrong]}
                      average={volume(avg.bottleMl)}
                      formatValue={(v) => (units === 'metric' ? `${v} ml` : `${v} oz`)}
                    />
                  </View>
                ) : null}
              </Section>
            ) : null}

            {any('diapers') ? (
              <Section
                title="Diapers"
                color={TYPE_META.diaper.color}
                stats={[
                  ['Per day', avg.diapers.toFixed(1)],
                  ['Wet', avg.wet.toFixed(1)],
                  ['Dirty', avg.dirty.toFixed(1)],
                ]}
              >
                <BarChart bars={bars((s) => [s.diapers])} colors={[TYPE_META.diaper.color]} average={avg.diapers} />
              </Section>
            ) : null}

            {any('pumpedMl') ? (
              <Section title="Pumping" color={TYPE_META.pumping.color} stats={[['Per day', formatVolume(avg.pumpedMl, units)]]}>
                <BarChart
                  bars={bars((s) => [volume(s.pumpedMl)])}
                  colors={[TYPE_META.pumping.color]}
                  average={volume(avg.pumpedMl)}
                  formatValue={(v) => (units === 'metric' ? `${v} ml` : `${v} oz`)}
                />
              </Section>
            ) : null}

            {any('tummyMs') ? (
              <Section title="Tummy time" color={TYPE_META.activity.color} stats={[['Per day', formatHoursMinutes(avg.tummyMs)]]}>
                <BarChart bars={bars((s) => [s.tummyMs / 60_000])} colors={[TYPE_META.activity.color]} formatValue={(v) => `${v}m`} />
              </Section>
            ) : null}

            <Text className="text-ink-ghost text-xs mt-3">
              Averages over {avg.days} logged day{avg.days === 1 ? '' : 's'}, not counting today.
            </Text>
          </>
        )
      ) : null}

      <View className="mt-6">
        <Card>
          <Row label="Sleep schedule" value="Predicted" onPress={() => router.push('/schedule')} right={chevron} />
          <Row label="Growth charts" value="WHO" onPress={() => router.push('/growth')} right={chevron} />
          <Row label="Solids report" onPress={() => router.push('/solids')} right={chevron} />
          <Row label="Export CSV" onPress={() => router.push('/export')} right={chevron} />
        </Card>
      </View>
    </ScrollView>
  );
}

function Section({
  title,
  color,
  stats,
  children,
}: {
  title: string;
  color: string;
  stats: [string, string][];
  children: React.ReactNode;
}) {
  return (
    <View className="mt-5 bg-surface border border-line rounded-2xl p-4">
      <View className="flex-row items-center gap-2 mb-3">
        <View className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <Text className="text-ink font-semibold text-base">{title}</Text>
      </View>
      <View className="flex-row flex-wrap gap-x-6 gap-y-2 mb-4">
        {stats.map(([label, value]) => (
          <View key={label}>
            <Text className="text-ink-faint text-[11px]">{label}</Text>
            <Text className="text-ink-bright text-base font-semibold">{value}</Text>
          </View>
        ))}
      </View>
      {children}
    </View>
  );
}
