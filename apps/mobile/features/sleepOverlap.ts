import { t } from '@subby/shared/i18n';
import { overlappingSleep, startOfDay } from '@subby/shared';
import { useLogQuery } from '../store/queries';
import { useLogStore } from '../store/useLogStore';
import { formatDayLabel, useFormatTime } from '../store/timeHelpers';

const WEEK = 7 * 86_400_000;

/**
 * The sleep a new or edited sleep [start, end) would overlap (end null: still going), with a message to show,
 * or null. Reads sleeps from a week before the start (also outside the loaded window), plus the loaded ones
 * (a forgotten running sleep can be older). `exclude`: the entry being edited (a night: all its pieces).
 */
export function useSleepOverlap(check: boolean, start: number, end: number | null, exclude?: string | string[]): string | null {
  const formatTime = useFormatTime();
  const nearby = useLogQuery({ from: startOfDay(start) - WEEK, types: ['sleep'] });
  const loaded = useLogStore((s) => s.logs);
  if (!check) return null;
  const other = overlappingSleep([...(nearby ?? []), ...loaded], start, end, exclude);
  if (!other) return null;
  const at = (ms: number) => (startOfDay(ms) === startOfDay(Date.now()) ? formatTime(ms) : t('overlap.dayTime', { day: formatDayLabel(ms), time: formatTime(ms) }));
  return other.endedAt === null
    ? t('overlap.running', { time: at(other.startedAt) })
    : t('overlap.other', { from: at(other.startedAt), to: at(other.endedAt) });
}
