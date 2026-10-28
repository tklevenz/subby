import type { LogEntry, PayloadOf } from '../schemas/log.schema';
import { startOfDay } from './time';

/** Local midnight `n` days after `dayStart` (DST-safe, unlike adding 24h). */
export function addDays(dayStart: number, n: number): number {
  const d = new Date(dayStart);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** `count` consecutive local day starts, oldest first, ending with the day of `lastDay`. */
export function dayRange(lastDay: number, count: number): number[] {
  const end = startOfDay(lastDay);
  return Array.from({ length: count }, (_, i) => addDays(end, i - count + 1));
}

const overlap = (start: number, end: number, from: number, to: number) =>
  Math.max(0, Math.min(end, to) - Math.max(start, from));

/** A sleep starting at `t` is a nap by default: it starts during the day (07–19h). */
export function isNapTime(t: number): boolean {
  const hour = new Date(t).getHours();
  return hour >= 7 && hour < 19;
}

/** Explicit nap flag, else daytime sleeps count as naps (`isNapTime`). */
export function isNap(l: LogEntry & { payload: PayloadOf<'sleep'> }): boolean {
  return l.payload.nap ?? isNapTime(l.startedAt);
}

export type DayStats = {
  day: number;
  /** Any entry started this day; untracked days are left out of averages. */
  tracked: boolean;
  sleepMs: number;
  napMs: number;
  nightMs: number;
  naps: number;
  /** Milk feeds (bottle + breast); solids are counted separately. */
  feeds: number;
  bottleMl: number;
  breastSec: number;
  solids: number;
  diapers: number;
  wet: number;
  dirty: number;
  pumpedMl: number;
  tummyMs: number;
};

const emptyDay = (day: number): DayStats => ({
  day, tracked: false, sleepMs: 0, napMs: 0, nightMs: 0, naps: 0, feeds: 0, bottleMl: 0, breastSec: 0,
  solids: 0, diapers: 0, wet: 0, dirty: 0, pumpedMl: 0, tummyMs: 0,
});

/**
 * Per-day totals for the given day starts. Sleep and tummy time are split across midnight;
 * running timers count up to `now`. Counts are attributed to the day an entry started.
 */
export function dailyStats(logs: LogEntry[], days: number[], now: number): DayStats[] {
  const out = days.map(emptyDay);
  const index = new Map(days.map((d, i) => [d, i]));
  const rangeStart = days[0] ?? 0;
  const rangeEnd = days.length ? addDays(days[days.length - 1], 1) : 0;

  for (const l of logs) {
    const end = l.endedAt ?? now;
    if (end < rangeStart || l.startedAt >= rangeEnd) continue;
    const p = l.payload;

    // Durations are split across every day they overlap.
    if (p.type === 'sleep' || (p.type === 'activity' && p.kind === 'tummy_time')) {
      for (let d = startOfDay(l.startedAt); d < end && d < rangeEnd; d = addDays(d, 1)) {
        const i = index.get(d);
        if (i === undefined) continue;
        const ms = overlap(l.startedAt, end, d, addDays(d, 1));
        if (p.type === 'activity') out[i].tummyMs += ms;
        else {
          const nap = isNap(l as LogEntry & { payload: PayloadOf<'sleep'> });
          out[i].sleepMs += ms;
          if (nap) out[i].napMs += ms;
          else out[i].nightMs += ms;
        }
      }
    }

    const i = index.get(startOfDay(l.startedAt));
    if (i === undefined) continue;
    const s = out[i];
    s.tracked = true;
    switch (p.type) {
      case 'sleep':
        if (isNap(l as LogEntry & { payload: PayloadOf<'sleep'> })) s.naps++;
        break;
      case 'feed':
        if (p.method === 'solids') s.solids++;
        else {
          s.feeds++;
          s.bottleMl += p.method === 'bottle' ? p.amountMl ?? 0 : 0;
          s.breastSec += (p.leftSeconds ?? 0) + (p.rightSeconds ?? 0);
        }
        break;
      case 'diaper':
        s.diapers++;
        if (p.condition === 'wet' || p.condition === 'both') s.wet++;
        if (p.condition === 'dirty' || p.condition === 'both') s.dirty++;
        break;
      case 'pumping':
        s.pumpedMl += p.amountMl ?? (p.leftMl ?? 0) + (p.rightMl ?? 0);
        break;
    }
  }
  return out;
}

export type StatsAverages = Omit<DayStats, 'day' | 'tracked'> & { days: number };

/** Mean per tracked day. */
export function averageStats(days: DayStats[]): StatsAverages {
  const tracked = days.filter((d) => d.tracked);
  const avg = emptyDay(0) as DayStats;
  const keys = Object.keys(avg).filter((k) => k !== 'day' && k !== 'tracked') as (keyof StatsAverages)[];
  const result = { days: tracked.length } as StatsAverages;
  for (const k of keys) {
    if (k === 'days') continue;
    const sum = tracked.reduce((a, d) => a + (d[k as keyof DayStats] as number), 0);
    result[k] = tracked.length ? sum / tracked.length : 0;
  }
  return result;
}

export type Segment = { id: string; start: number; end: number; nap: boolean; running: boolean };

/** Sleep periods overlapping [from, to), clipped to it. */
export function sleepSegments(logs: LogEntry[], from: number, to: number, now: number): Segment[] {
  const out: Segment[] = [];
  for (const l of logs) {
    if (l.payload.type !== 'sleep') continue;
    const end = l.endedAt ?? now;
    if (end <= from || l.startedAt >= to) continue;
    out.push({
      id: l.id,
      start: Math.max(l.startedAt, from),
      end: Math.min(end, to),
      nap: isNap(l as LogEntry & { payload: PayloadOf<'sleep'> }),
      running: l.endedAt === null,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

export type FoodStat = {
  name: string;
  count: number;
  firstAt: number;
  lastAt: number;
  reactions: string[];
  allergen: boolean;
};

/** Every food tried, merged case-insensitively, most recently eaten first. */
export function solidsReport(logs: LogEntry[]): FoodStat[] {
  const foods = new Map<string, FoodStat>();
  for (const l of logs) {
    const p = l.payload;
    if (p.type !== 'feed' || !p.foods?.length) continue;
    for (const raw of p.foods) {
      const name = raw.trim();
      const key = name.toLowerCase();
      if (!key) continue;
      const f = foods.get(key) ?? { name, count: 0, firstAt: l.startedAt, lastAt: l.startedAt, reactions: [], allergen: false };
      f.count++;
      f.firstAt = Math.min(f.firstAt, l.startedAt);
      if (l.startedAt >= f.lastAt) {
        f.lastAt = l.startedAt;
        f.name = name; // latest spelling wins
      }
      const reaction = p.reaction?.trim();
      if (reaction && !f.reactions.includes(reaction)) f.reactions.push(reaction);
      if (p.allergen) f.allergen = true;
      foods.set(key, f);
    }
  }
  return [...foods.values()].sort((a, b) => b.lastAt - a.lastAt);
}
