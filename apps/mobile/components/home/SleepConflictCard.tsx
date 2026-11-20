import { t } from '@subby/shared/i18n';
import { mergedSleep, sleepConflicts, startOfDay, DAY_MS } from '@subby/shared';
import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLogStore } from '../../store/useLogStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { formatDayLabel, useFormatTime } from '../../store/timeHelpers';
import { useSingleFlight } from '../useSingleFlight';

/** Sleeps that started this long ago or less are checked: older overlaps were long settled (or imported so). */
const LOOK_BACK_MS = 2 * DAY_MS;

/**
 * Home: two sleeps of this child at the same time, which only happens when two phones logged the same sleep before
 * either saw the other's (LAUNCH.md A16). Merge folds the later-created one into the first (the same result on
 * every phone, so two parents merging at once agree); Keep both stops asking on this phone.
 */
export function SleepConflictCard() {
  const logs = useLogStore((s) => s.logs);
  const kept = useSettingsStore((s) => s.keptOverlaps);
  const formatTime = useFormatTime();
  const once = useSingleFlight();
  // `logs` changes with every write, so a minute-old `now` is fine here.
  const conflict = useMemo(() => sleepConflicts(logs, Date.now() - LOOK_BACK_MS).find((c) => !kept.includes(c.key)), [logs, kept]);
  if (!conflict) return null;

  const at = (ms: number) => (startOfDay(ms) === startOfDay(Date.now()) ? formatTime(ms) : t('overlap.dayTime', { day: formatDayLabel(ms), time: formatTime(ms) }));
  const [a, b] = [conflict.keep.startedAt, conflict.drop.startedAt].sort((x, y) => x - y);
  const merge = once(() =>
    useLogStore.getState().writeLogs({ update: [{ id: conflict.keep.id, patch: mergedSleep(conflict) }], remove: [conflict.drop.id] }),
  );
  const keepBoth = once(() => useSettingsStore.getState().set('keptOverlaps', [...useSettingsStore.getState().keptOverlaps, conflict.key].slice(-50)));

  return (
    <View className="mx-4 mb-2 rounded-xl bg-violet/10 border border-violet/40 px-4 py-3">
      <Text className="text-ink text-sm font-semibold">{t('conflict.title')}</Text>
      <Text className="text-ink-muted text-sm leading-5 mt-0.5">{t('conflict.body', { first: at(a!), second: at(b!) })}</Text>
      <View className="flex-row mt-2">
        <Pressable onPress={() => void merge()} hitSlop={8} accessibilityRole="button" className="mr-5">
          <Text className="text-violet-soft text-sm font-semibold">{t('conflict.merge')}</Text>
        </Pressable>
        <Pressable onPress={() => void keepBoth()} hitSlop={8} accessibilityRole="button">
          <Text className="text-ink-muted text-sm font-semibold">{t('conflict.keepBoth')}</Text>
        </Pressable>
      </View>
    </View>
  );
}
