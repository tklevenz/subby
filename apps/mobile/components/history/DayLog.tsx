import { formatDate, formatNumber, t } from '@subby/shared/i18n';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  dayTimeline,
  formatHoursMinutes,
  formatVolume,
  startOfDay,
  type DayStats,
  type LogEntry,
  type Night,
  type TimelineItem,
  type UnitSystem,
} from '@subby/shared';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useFormatTime } from '../../store/timeHelpers';
import { logDisplay } from '../logDisplay';
import { Moon } from '../icons';
import { colors } from '../../theme/colors';
import { EmptyState } from '../brand/EmptyState';
import NightBar, { stretchesOf } from '../NightBar';

/** The day's sleep, feeds and diapers as plain figures in one row. */
export function DayTotals({ stats, units }: { stats: DayStats; units: UnitSystem }) {
  const naps = stats.naps ? t('day.naps', { count: stats.naps }) : '';
  const sleepSub = stats.nightMs && naps ? t('day.nightAndNaps', { naps }) : stats.nightMs ? t('day.night') : naps;
  const items = [
    { label: t('day.sleep'), className: 'text-violet-soft', value: stats.sleepMs ? formatHoursMinutes(stats.sleepMs) : '–', sub: sleepSub },
    {
      label: t('day.feeds'),
      className: 'text-cyan-soft',
      value: String(stats.feeds),
      sub: stats.bottleMl ? t('day.bottle', { amount: formatVolume(stats.bottleMl, units) }) : stats.breastSec ? t('day.breast', { span: formatHoursMinutes(stats.breastSec * 1000) }) : '',
    },
    { label: t('day.diapers'), className: 'text-amber-strong', value: formatNumber(stats.diapers), sub: stats.diapers ? t('day.wetDirty', { wet: stats.wet, dirty: stats.dirty }) : '' },
  ];
  return (
    <View className="flex-row gap-3.5 py-3 border-t border-b border-line">
      {items.map((i, n) => (
        <React.Fragment key={i.label}>
          {n ? <View className="w-px self-stretch bg-line" /> : null}
          <View className="flex-1 min-w-0">
            <Text className={`text-xs font-semibold ${i.className}`}>{i.label}</Text>
            <Text className="text-ink text-[22px] leading-[26px] font-bold" style={{ fontVariant: ['tabular-nums'] }}>
              {i.value}
            </Text>
            <Text className="text-ink-muted text-xs" numberOfLines={1}>
              {i.sub || ' '}
            </Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

/**
 * One day as a timeline, newest first: times on the left, entries on a rail (sleeps as thick spans), and the
 * wake windows between sleeps. Tap an entry to open it.
 */
export function DayLog({ logs, day, now }: { logs: LogEntry[]; day: number; now: number }) {
  const items = dayTimeline(logs, day, now);
  if (!items.length) return <EmptyState title={t('day.emptyTitle')} text={t('day.emptyText')} />;
  return (
    <View>
      {items.map((item) =>
        item.kind === 'awake' ? (
          <AwakeRow key={`awake-${item.from}`} item={item} />
        ) : item.kind === 'night' ? (
          <NightRow key={`night-${item.night.pieces[0]!.id}`} night={item.night} day={day} now={now} />
        ) : (
          <EntryRow key={item.entry.id} entry={item.entry} day={day} />
        ),
      )}
    </View>
  );
}

function AwakeRow({ item }: { item: Extract<TimelineItem, { kind: 'awake' }> }) {
  const length = formatHoursMinutes(item.to - item.from);
  return (
    <View className="flex-row items-center" style={{ minHeight: 34 }}>
      <View className="w-12" />
      {/* A dotted stretch of rail: awake, between two sleeps. */}
      <View className="w-7 self-stretch items-center justify-evenly">
        {[0, 1, 2, 3].map((i) => (
          <View key={i} className="w-0.5 h-0.5 rounded-full bg-amber-pale/60" />
        ))}
      </View>
      <Text className="ml-2.5 text-xs font-medium text-amber-pale">{t(item.ongoing ? 'day.awakeSoFar' : 'day.awake', { span: length })}</Text>
    </View>
  );
}

/**
 * A night with wakings as one block: time asleep, a bar of sleep and wakings, and the wakings listed when opened.
 * Tapping it opens the night editor. The toggle sits beside the open target, not inside it: buttons nested in a
 * Pressable don't reliably get their own taps on Android.
 */
function NightRow({ night, day, now }: { night: Night; day: number; now: number }) {
  const formatTime = useFormatTime();
  const [open, setOpen] = useState(false);
  const edit = () => router.push(`/entry/${night.pieces[0]!.id}`);
  const n = night.wakings.length;
  const running = night.end === null;
  return (
    <View className="flex-row" style={{ minHeight: 64 }}>
      <View className="w-12 pt-4">
        <Text className="text-[13px] text-ink-soft" style={{ fontVariant: ['tabular-nums'] }}>
          {formatTime(night.start)}
        </Text>
        {night.start < day ? (
          <Text className="text-[11px] text-ink-faint">{formatDate(startOfDay(night.start), { weekday: 'short' })}</Text>
        ) : null}
      </View>
      <View className="w-7 self-stretch items-center pt-3">
        <View className="absolute top-0 bottom-0 w-1.5 rounded-full bg-violet" />
        <View className="w-7 h-7 rounded-full bg-violet-deep items-center justify-center">
          <Moon color={colors.ink} size={13} />
        </View>
      </View>
      <View className="flex-1 min-w-0 ml-2.5 py-1.5">
        <View className="bg-violet/10 border border-violet/35 rounded-2xl">
          <View className="flex-row items-center">
            <Pressable onPress={edit} accessibilityRole="button" className="flex-1 pl-3.5 pt-3 pb-2">
              <Text className="text-[15px] font-semibold text-ink" numberOfLines={1}>
                {t(running ? 'day.nightAsleepSoFar' : 'day.nightAsleep', { span: formatHoursMinutes(night.asleepMs) })}
              </Text>
            </Pressable>
            <Pressable onPress={() => setOpen(!open)} hitSlop={8} accessibilityRole="button" className="px-3.5 pt-3 pb-2">
              <Text className="text-violet-soft text-[13px]">{open ? t('day.hide') : t('day.wakings', { count: n })}</Text>
            </Pressable>
          </View>
          <Pressable onPress={edit} className="px-3.5 pb-3">
            <NightBar stretches={stretchesOf(night.pieces, now)} />
            <View className="flex-row justify-between mt-1.5">
              <Text className="text-ink-muted text-xs">{formatTime(night.start)}</Text>
              <Text className="text-ink-muted text-xs">{running ? t('day.asleepNow') : formatTime(night.end!)}</Text>
            </View>
            {open ? (
              <View className="mt-1">
                {night.wakings.map((w) => (
                  <View key={w.start} className="flex-row items-center pt-2 mt-2 border-t border-violet/20">
                    <View className="w-2 h-2 rounded-full bg-amber-pale" />
                    <Text className="flex-1 text-ink text-sm ml-2.5">
                      {t('day.awakeFromTo', { from: formatTime(w.start), to: formatTime(w.end) })}
                    </Text>
                    <Text className="text-ink-muted text-xs">{formatHoursMinutes(w.end - w.start)}</Text>
                  </View>
                ))}
                <Text className="text-ink-faint text-xs mt-2.5">{t('day.longest', { span: formatHoursMinutes(night.longestMs) })}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function EntryRow({ entry, day }: { entry: LogEntry; day: number }) {
  const units = useSettingsStore((s) => s.units);
  const formatTime = useFormatTime();
  const display = logDisplay(entry, units, formatTime);
  const sleep = entry.logType === 'sleep';
  // A night that started the evening before still shows its start time, with the weekday under it.
  const earlier = entry.startedAt < day;
  return (
    <Pressable
      onPress={() => router.push(`/entry/${entry.id}`)}
      accessibilityRole="button"
      accessibilityLabel={t(display.detail ? 'day.rowA11yDetail' : 'day.rowA11y', { time: formatTime(entry.startedAt), label: display.label, detail: display.detail })}
      className="flex-row items-center"
      style={{ minHeight: sleep ? 64 : 52 }}
    >
      <View className="w-12">
        <Text className="text-[13px] text-ink-soft" style={{ fontVariant: ['tabular-nums'] }}>
          {formatTime(entry.startedAt)}
        </Text>
        {earlier ? (
          <Text className="text-[11px] text-ink-faint">{formatDate(startOfDay(entry.startedAt), { weekday: 'short' })}</Text>
        ) : null}
      </View>
      <View className="w-7 self-stretch items-center justify-center">
        {sleep ? (
          <View className="absolute top-0 bottom-0 w-1.5 rounded-full bg-violet" />
        ) : (
          <View className="absolute top-0 bottom-0 w-0.5 bg-line" />
        )}
        {sleep ? (
          <View className="w-7 h-7 rounded-full bg-violet-deep items-center justify-center">
            <Moon color={colors.ink} size={13} />
          </View>
        ) : (
          <View
            className="w-7 h-7 rounded-full bg-ground border items-center justify-center"
            style={{ borderColor: display.color }}
          >
            <View style={{ transform: [{ scale: 0.8 }] }}>{display.icon}</View>
          </View>
        )}
      </View>
      <View className="flex-1 min-w-0 ml-2.5 py-1.5">
        <Text className="text-[15px] font-semibold text-ink" numberOfLines={1}>
          {display.label}
        </Text>
        {display.detail ? (
          <Text className="text-[13px] text-ink-muted" numberOfLines={2}>
            {display.detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
