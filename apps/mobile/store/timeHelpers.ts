import { useEffect, useState } from 'react';
import { addDays, startOfDay } from '@kindred-log/shared';
import { useSettingsStore } from './useSettingsStore';

export { formatDuration, formatRelative, formatAge } from '@kindred-log/shared';

/** Current time, re-rendering every `intervalMs` (1 s is plenty for h/m/s timers). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function formatTimeShort(epochMs: number, clock: '12h' | '24h' = '24h'): string {
  return new Date(epochMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: clock === '12h',
  });
}

export function formatDayLabel(epochMs: number, now = Date.now()): string {
  const d = new Date(epochMs);
  const today = new Date(now);
  const day = startOfDay(epochMs);
  if (day === startOfDay(now)) return 'Today';
  // Calendar day before, not 24 h before (DST days are 23/25 h).
  if (day === addDays(startOfDay(now), -1)) return 'Yesterday';
  return d.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
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

/** formatTimeShort bound to the user's clock preference. */
export function useFormatTime() {
  const clock = useSettingsStore((s) => s.clock);
  return (epochMs: number) => formatTimeShort(epochMs, clock);
}
