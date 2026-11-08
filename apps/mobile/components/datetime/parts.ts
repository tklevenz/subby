import { addDays, startOfDay } from '@subby/shared';

/** How far back the day wheel goes (further when the value itself is older, e.g. an imported entry). */
export const DAYS_BACK = 365;

/**
 * Day starts for the day wheel, oldest first, ending today (or at `max`'s day, or the value's day if later).
 * Built from calendar days, so DST days (23/25 h) don't skew it.
 */
export function dayOptions(value: number, now: number, max?: number): number[] {
  const today = startOfDay(now);
  const first = Math.min(startOfDay(value), addDays(today, -DAYS_BACK));
  const last = Math.max(startOfDay(value), startOfDay(max ?? now));
  const days: number[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  return days;
}

/** A moment as wheel positions: its day start, hour (0–23) and minute. */
export function splitTime(ms: number) {
  const d = new Date(ms);
  return { day: startOfDay(ms), hour: d.getHours(), minute: d.getMinutes() };
}

/** Back from wheel positions to epoch ms (local time). */
export function joinTime(day: number, hour: number, minute: number): number {
  const d = new Date(day);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/** 0–23 → 1–12 plus AM/PM, and back. */
export const to12 = (hour: number) => ({ hour12: hour % 12 === 0 ? 12 : hour % 12, pm: hour >= 12 });
export const from12 = (hour12: number, pm: boolean) => (hour12 % 12) + (pm ? 12 : 0);

export const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

/**
 * A month as calendar weeks starting on Monday: local midnights, null for the padding before the 1st and
 * after the last day.
 */
export function monthGrid(year: number, month: number): (number | null)[][] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0
  const cells: (number | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysInMonth(year, month); d++) cells.push(new Date(year, month, d).getTime());
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}
