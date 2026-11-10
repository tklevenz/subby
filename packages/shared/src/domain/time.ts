import { t } from '../i18n';

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) return t('time.hm', { h, m });
  if (m > 0) return t('time.ms', { m, s });
  return t('time.s', { s });
}

/** Time since something, coarse: "2h 15m", "1d 3h", "5m"; null under a minute. */
export function formatElapsed(msAgo: number): string | null {
  const totalSec = Math.max(0, Math.floor(msAgo / 1000));
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);

  if (d > 0) return t('time.dh', { d, h });
  if (h > 0) return t('time.hm', { h, m });
  if (m > 0) return t('time.m', { m });
  return null;
}

/** "2h 15m ago", "Just now". */
export function formatRelative(msAgo: number): string {
  const span = formatElapsed(msAgo);
  return span ? t('time.ago', { span }) : t('time.justNow');
}

/** Local-time start of day (00:00) for the given epoch ms. */
export function startOfDay(epochMs: number): number {
  const d = new Date(epochMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Age in whole days between an ISO birth date (YYYY-MM-DD, local) and `now`. */
export function ageInDays(birthDate: string, now: number): number {
  const [y, m, d] = birthDate.split('-').map(Number);
  const birth = new Date(y, m - 1, d).getTime();
  // Rounded: across a DST change a day is 23 or 25 h, so whole days aren't whole multiples of 24 h.
  return Math.round((startOfDay(now) - birth) / 86_400_000);
}

export function formatAge(birthDate: string, now: number): string {
  const days = ageInDays(birthDate, now);
  if (days < 0) return t('age.notBorn');
  if (days < 14) return t('age.days', { count: days });
  if (days < 7 * 13) return t('age.weeks', { count: Math.floor(days / 7) });
  const months = Math.floor(days / 30.4375);
  if (months < 24) return t('age.months', { count: months });
  return t('age.years', { count: Math.floor(months / 12) });
}

/** Hours and minutes only ("13h 20m", "45m"), for totals where seconds are noise. */
export function formatHoursMinutes(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return m > 0 ? t('time.hm', { h, m }) : t('time.h', { h });
  return t('time.m', { m });
}

/** How long something finished took: "1h 29m", "2h", "55m"; seconds only under a minute. (Live timers use `formatDuration`.) */
export function formatSpan(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  return totalSec < 60 ? t('time.s', { s: totalSec }) : formatHoursMinutes(Math.floor(totalSec / 60) * 60_000);
}

const fromIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Same day-of-month `n` months later, clamped (31 Jan + 1 month = 28/29 Feb). */
function addMonths(date: Date, n: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b.getTime()) - startOfDay(a.getTime())) / 86_400_000);

/** Calendar age: whole months since birth plus the remaining days. */
export function ageParts(birthDate: string, now: number): { months: number; days: number } {
  const birth = fromIso(birthDate);
  const today = new Date(startOfDay(now));
  let months = (today.getFullYear() - birth.getFullYear()) * 12 + today.getMonth() - birth.getMonth();
  if (addMonths(birth, months) > today) months--;
  if (months < 0) return { months: 0, days: Math.max(0, daysBetween(birth, today)) };
  return { months, days: daysBetween(addMonths(birth, months), today) };
}

const plural = (count: number, unit: 'day' | 'week' | 'month' | 'year') => t(`age.${unit}s`, { count });
const pair = (a: string, b: string) => t('age.pair', { a, b });

/** "12 days", "5 weeks, 2 days", "8 months, 12 days", "2 years, 3 months". */
export function formatAgeLong(birthDate: string, now: number): string {
  const totalDays = ageInDays(birthDate, now);
  if (totalDays < 0) return t('age.notBorn');
  if (totalDays < 14) return plural(totalDays, 'day');
  const { months, days } = ageParts(birthDate, now);
  if (months < 3) {
    const rest = totalDays % 7;
    return rest ? pair(plural(Math.floor(totalDays / 7), 'week'), plural(rest, 'day')) : plural(totalDays / 7, 'week');
  }
  if (months < 24) return days ? pair(plural(months, 'month'), plural(days, 'day')) : plural(months, 'month');
  const years = Math.floor(months / 12);
  return months % 12 ? pair(plural(years, 'year'), plural(months % 12, 'month')) : plural(years, 'year');
}

/**
 * The next age worth celebrating: each month in the first year, then birthdays.
 * `days` is 0 on the day itself.
 */
export function nextAgeMilestone(birthDate: string, now: number): { label: string; at: number; days: number } {
  const birth = fromIso(birthDate);
  const today = new Date(startOfDay(now));
  const { months, days } = ageParts(birthDate, now);
  const next = (m: number) => {
    const at = addMonths(birth, m);
    return { label: m < 12 ? plural(m, 'month') : plural(m / 12, 'year'), at: at.getTime(), days: daysBetween(today, at) };
  };
  if (days === 0 && months > 0 && (months < 12 || months % 12 === 0)) return next(months);
  return months < 11 ? next(months + 1) : next((Math.floor(months / 12) + 1) * 12);
}
