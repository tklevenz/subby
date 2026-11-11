import { t } from '@subby/shared/i18n';
import { overlappingSleep, startOfDay, DAY_MS, type LogEntry } from '@subby/shared';
import { useLogQuery } from '../store/queries';
import { useLogStore } from '../store/useLogStore';
import { formatDayLabel, useFormatTime } from '../store/timeHelpers';

const WEEK_MS = 7 * DAY_MS;

/** The sleeps to check against: a week before the start (also outside the loaded window), plus the loaded ones. */
function useNearbySleeps(start: number) {
  const nearby = useLogQuery({ from: startOfDay(start) - WEEK_MS, types: ['sleep'] });
  const loaded = useLogStore((s) => s.logs);
  return [...(nearby ?? []), ...loaded];
}

/** The message for the sleep that [start, end) would overlap (end null: still going), or null. */
function useOverlapMessage() {
  const formatTime = useFormatTime();
  return (sleeps: LogEntry[], start: number, end: number | null, exclude?: string | string[]): string | null => {
    const other = overlappingSleep(sleeps, start, end, exclude);
    if (!other) return null;
    const at = (ms: number) => (startOfDay(ms) === startOfDay(Date.now()) ? formatTime(ms) : t('overlap.dayTime', { day: formatDayLabel(ms), time: formatTime(ms) }));
    return other.endedAt === null
      ? t('overlap.running', { time: at(other.startedAt) })
      : t('overlap.other', { from: at(other.startedAt), to: at(other.endedAt) });
  };
}

/**
 * The sleep a new or edited sleep [start, end) would overlap (end null: still going), with a message to show,
 * or null. Reads sleeps from a week before the start and the loaded ones (a forgotten running sleep can be older).
 * `exclude`: the entry being edited (a night: all its pieces).
 */
export function useSleepOverlap(check: boolean, start: number, end: number | null, exclude?: string | string[]): string | null {
  const sleeps = useNearbySleeps(start);
  const message = useOverlapMessage();
  return check ? message(sleeps, start, end, exclude) : null;
}

/**
 * The log sheet's two questions from one read of the sleeps: what Save would log (`save`, from the start to
 * `end`; null while there's no end) and what a timer from the start would (`timer`). `shown` is the one to
 * display: the saved span once there is an end, else the timer's.
 */
export function useSleepOverlaps(check: boolean, start: number, end: number | null) {
  const sleeps = useNearbySleeps(start);
  const message = useOverlapMessage();
  if (!check) return { save: null, timer: null, shown: null };
  const save = end !== null ? message(sleeps, start, end) : null;
  const timer = message(sleeps, start, null);
  return { save, timer, shown: end !== null ? save : timer };
}
