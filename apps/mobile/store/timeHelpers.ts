import { useEffect, useState } from 'react';
import { addDays, startOfDay } from '@subby/shared';
import { formatClock, formatDate, t } from '@subby/shared/i18n';
import { useSettingsStore } from './useSettingsStore';

export { formatDuration, formatRelative, formatAge } from '@subby/shared';

/** Current time, re-rendering every `intervalMs` (1 s is plenty for h/m/s timers). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** "Sat, Oct 24", with the year only when it isn't this one. */
function weekdayDate(epochMs: number, now: number): string {
  const sameYear = new Date(epochMs).getFullYear() === new Date(now).getFullYear();
  return formatDate(epochMs, { weekday: 'short', day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' });
}

export function formatDayLabel(epochMs: number, now = Date.now()): string {
  const day = startOfDay(epochMs);
  if (day === startOfDay(now)) return t('day.today');
  // Calendar day before, not 24 h before (DST days are 23/25 h).
  if (day === addDays(startOfDay(now), -1)) return t('day.yesterday');
  return weekdayDate(epochMs, now);
}

/** A day inside a sentence: "today", "yesterday", else "on Sat, Oct 24" (never lowercased by hand). */
export function formatDayInline(epochMs: number, now = Date.now()): string {
  const day = startOfDay(epochMs);
  if (day === startOfDay(now)) return t('day.todayInline');
  if (day === addDays(startOfDay(now), -1)) return t('day.yesterdayInline');
  return t('day.onDate', { date: weekdayDate(epochMs, now) });
}

/** Local calendar date as YYYY-MM-DD. */
export function toIsoDate(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD to local midnight epoch ms. */
export function fromIsoDate(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** `formatClock` bound to the user's clock preference. */
export function useFormatTime() {
  const clock = useSettingsStore((s) => s.clock);
  return (epochMs: number) => formatClock(epochMs, clock);
}
