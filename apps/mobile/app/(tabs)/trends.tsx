import { formatDate, formatNumber, t } from '@subby/shared/i18n';
import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TabHeader from '../../components/TabHeader';
import { addDays, averageNights, averageStats, dailyStats, dayRange, formatHoursMinutes, formatVolume, groupNights, mlToOz, nightsByDay, startOfDay, type DayStats, HOUR_MS } from '@subby/shared';
import BarChart, { type Bar } from '../../components/charts/BarChart';
import { TYPE_META } from '../../components/logTypes';
import { Card, Row, Segmented, Chevron } from '../../components/ui';
import { useLogQuery } from '../../store/queries';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useNow } from '../../store/timeHelpers';
import { colors } from '../../theme/colors';
import { EmptyState } from '../../components/brand/EmptyState';

const RANGE_VALUES = ['7', '14', '30'] as const;
const ranges = () => RANGE_VALUES.map((value) => ({ value, label: t('trends.days', { count: Number(value) }) }));
/** An average with one decimal, in the app's language ("1.5", "1,5"). */
const one = (n: number) => formatNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });


export default function TrendsScreen() {
  const insets = useSafeAreaInsets();
  const now = useNow(60_000);
  const units = useSettingsStore((s) => s.units);
  const [range, setRange] = useState<(typeof RANGE_VALUES)[number]>('7');
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

  const bars = (values: (s: DayStats) => number[]): Bar[] =>
    (stats ?? []).map((s) => ({
      label: count <= 7 ? formatDate(s.day, { weekday: 'narrow' }) : String(new Date(s.day).getDate()),
      values: values(s),
      dim: s.day === today,
    }));

  const nightBars = (value: (n: NonNullable<NonNullable<typeof nights>[number]>) => number): Bar[] =>
    days.map((day, i) => ({
      label: count <= 7 ? formatDate(day, { weekday: 'narrow' }) : String(new Date(day).getDate()),
      values: [nights?.[i] ? value(nights[i]!) : 0],
    }));

  const volume = (ml: number) => (units === 'metric' ? ml : mlToOz(ml));
  const any = (k: keyof DayStats) => stats?.some((s) => (s[k] as number) > 0) ?? false;

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <TabHeader />
      {/* The range stays put; the charts scroll. */}
      <View className="px-4 pb-2">
        <Segmented options={ranges()} value={range} onChange={setRange} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32 }}>

      {stats && avg ? (
        avg.days === 0 && !stats[stats.length - 1].tracked ? (
          <EmptyState small text={t('trends.empty')} />
        ) : (
          <>
            {any('sleepMs') ? (
              <Section
                title={t('trends.sleep')}
                color={TYPE_META.sleep.color}
                stats={[
                  [t('trends.perDay'), formatHoursMinutes(avg.sleepMs)],
                  [t('trends.night'), formatHoursMinutes(avg.nightMs), colors.violetDeep],
                  [t('trends.naps'), t('trends.napsValue', { count: one(avg.naps), span: formatHoursMinutes(avg.napMs) }), colors.violetSoft],
                ]}
              >
                <BarChart
                  bars={bars((s) => [s.nightMs / HOUR_MS, s.napMs / HOUR_MS])}
                  colors={[colors.violetDeep, colors.violetSoft]}
                  average={avg.sleepMs / HOUR_MS}
                  formatValue={(v) => `${v}h`}
                />
              </Section>
            ) : null}

            {/* Only once wakings are logged: without them, a night's longest stretch is just the night. */}
            {avgNight && nights?.some((n) => n && n.wakings > 0) ? (
              <Section
                title={t('trends.nights')}
                color={colors.violetDeep}
                stats={[
                  [t('trends.asleep'), formatHoursMinutes(avgNight.asleepMs)],
                  [t('trends.wakings'), one(avgNight.wakings)],
                  [t('trends.longest'), formatHoursMinutes(avgNight.longestMs)],
                  [t('trends.awake'), formatHoursMinutes(avgNight.awakeMs)],
                ]}
              >
                <Text className="text-ink-muted text-xs mb-1">{t('trends.wakings')}</Text>
                <BarChart bars={nightBars((n) => n.wakings)} colors={[colors.amberPale]} average={avgNight.wakings} />
                <View className="mt-4">
                  <Text className="text-ink-muted text-xs mb-1">{t('trends.longest')}</Text>
                  <BarChart
                    bars={nightBars((n) => n.longestMs / HOUR_MS)}
                    colors={[colors.violetDeep]}
                    average={avgNight.longestMs / HOUR_MS}
                    formatValue={(v) => `${v}h`}
                  />
                </View>
              </Section>
            ) : null}

            {any('feeds') || any('solids') ? (
              <Section
                title={t('trends.feeding')}
                color={TYPE_META.feed.color}
                stats={[
                  [t('trends.feedsPerDay'), one(avg.feeds), any('solids') ? TYPE_META.feed.color : undefined],
                  ...(any('bottleMl') ? [[t('trends.bottlePerDay'), formatVolume(avg.bottleMl, units)] as Stat] : []),
                  ...(any('breastSec') ? [[t('trends.breastPerDay'), formatHoursMinutes(avg.breastSec * 1000)] as Stat] : []),
                  ...(any('solids') ? [[t('trends.solidsPerDay'), one(avg.solids), colors.amberPale] as Stat] : []),
                ]}
              >
                <BarChart bars={bars((s) => [s.feeds, s.solids])} colors={[TYPE_META.feed.color, colors.amberPale]} average={avg.feeds} />
                {any('bottleMl') ? (
                  <View className="mt-4">
                    <Text className="text-ink-muted text-xs mb-1">{t('trends.bottleVolume')}</Text>
                    <BarChart
                      bars={bars((s) => [volume(s.bottleMl)])}
                      colors={[colors.cyanStrong]}
                      average={volume(avg.bottleMl)}
                      formatValue={(v) => `${formatNumber(v)} ${units === 'metric' ? 'ml' : 'oz'}`}
                    />
                  </View>
                ) : null}
              </Section>
            ) : null}

            {any('diapers') ? (
              <Section
                title={t('trends.diapers')}
                color={TYPE_META.diaper.color}
                stats={[
                  [t('trends.perDay'), one(avg.diapers)],
                  [t('trends.wet'), one(avg.wet)],
                  [t('trends.dirty'), one(avg.dirty)],
                ]}
              >
                <BarChart bars={bars((s) => [s.diapers])} colors={[TYPE_META.diaper.color]} average={avg.diapers} />
              </Section>
            ) : null}

            {any('pumpedMl') ? (
              <Section title={t('trends.pumping')} color={TYPE_META.pumping.color} stats={[[t('trends.perDay'), formatVolume(avg.pumpedMl, units)]]}>
                <BarChart
                  bars={bars((s) => [volume(s.pumpedMl)])}
                  colors={[TYPE_META.pumping.color]}
                  average={volume(avg.pumpedMl)}
                  formatValue={(v) => `${formatNumber(v)} ${units === 'metric' ? 'ml' : 'oz'}`}
                />
              </Section>
            ) : null}

            {any('tummyMs') ? (
              <Section title={t('trends.tummy')} color={TYPE_META.activity.color} stats={[[t('trends.perDay'), formatHoursMinutes(avg.tummyMs)]]}>
                <BarChart bars={bars((s) => [s.tummyMs / 60_000])} colors={[TYPE_META.activity.color]} formatValue={(v) => t('time.m', { m: v })} />
              </Section>
            ) : null}

            <Text className="text-ink-ghost text-xs mt-3">
              {t('trends.averages', { count: avg.days })}
            </Text>
          </>
        )
      ) : null}

      <View className="mt-6">
        <Card>
          <Row label={t('trends.schedule')} value={t('trends.predicted')} onPress={() => router.push('/schedule')} right={<Chevron />} />
          <Row label={t('trends.growth')} value={t('trends.who')} onPress={() => router.push('/growth')} right={<Chevron />} />
          <Row label={t('trends.solids')} onPress={() => router.push('/solids')} right={<Chevron />} />
          <Row label={t('trends.export')} onPress={() => router.push('/export')} right={<Chevron />} />
        </Card>
      </View>
      </ScrollView>
    </View>
  );
}

/** A number above a chart: label, value and, where the chart stacks colors, the color it's drawn in. */
type Stat = [label: string, value: string, dot?: string];

function Section({
  title,
  color,
  stats,
  children,
}: {
  title: string;
  color: string;
  stats: Stat[];
  children: React.ReactNode;
}) {
  return (
    <View className="mt-5 bg-surface border border-line rounded-2xl p-4">
      <View className="flex-row items-center gap-2 mb-3">
        <View className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <Text className="text-ink font-semibold text-base">{title}</Text>
      </View>
      <View className="flex-row flex-wrap gap-x-6 gap-y-2 mb-4">
        {stats.map(([label, value, dot]) => (
          <View key={label}>
            <View className="flex-row items-center gap-1">
              {dot ? <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dot }} /> : null}
              <Text className="text-ink-faint text-[11px]">{label}</Text>
            </View>
            <Text className="text-ink-bright text-base font-semibold">{value}</Text>
          </View>
        ))}
      </View>
      {children}
    </View>
  );
}
