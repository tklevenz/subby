import { describe, expect, it } from 'vitest';
import { addDays, dailyStats } from '../domain/stats';
import { startOfDay } from '../domain/time';
import { groupNights } from '../domain/nights';
import { suggestedSchedule } from '../domain/prediction';
import type { LogEntry } from '../schemas/log.schema';
import { entry } from './fixtures';

// The test script pins TZ=Europe/Berlin, so these run across real clock changes on any machine.
const H = 3_600_000;
const at = (day: number, h: number, m = 0) => {
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};
const clock = (t: number) => new Date(t).toTimeString().slice(0, 5);
const night = (from: number, to: number) => entry({ type: 'sleep', nap: false }, from, to);
const nap = (from: number, to: number) => entry({ type: 'sleep', nap: true }, from, to);

describe.each([
  // Clocks go back: the day after is 25 h long, and a 19:30–06:30 night is 12 h of sleep.
  { label: 'back (Oct 25)', change: new Date(2026, 9, 25, 12).getTime(), dayHours: 25, nightHours: 12, before: 4.5, after: 7.5 },
  // Clocks go forward: 23 h, and the same night is 10 h.
  { label: 'forward (Mar 29)', change: new Date(2026, 2, 29, 12).getTime(), dayHours: 23, nightHours: 10, before: 4.5, after: 5.5 },
])('clocks going $label', ({ change, dayHours, nightHours, before, after }) => {
  const day = startOfDay(change);
  const eve = addDays(day, -1);

  it('runs in a zone with DST', () => {
    expect((addDays(day, 1) - day) / H).toBe(dayHours);
  });

  it('counts the real time asleep and splits it at midnight', () => {
    const n = night(at(eve, 19, 30), at(day, 6, 30));
    expect(groupNights([n], change)[0]!.asleepMs / H).toBe(nightHours);
    expect(dailyStats([n], [eve, day], change).map((d) => d.sleepMs / H)).toEqual([before, after]);
  });

  it('keeps the usual bedtime and naps on the wall clock', () => {
    const logs: LogEntry[] = [];
    for (let d = -8; d <= 0; d++) {
      const dd = addDays(day, d);
      logs.push(night(at(addDays(dd, -1), 19, 30), at(dd, 6, 30)));
      if (d < 0) logs.push(nap(at(dd, 9, 30), at(dd, 10, 45)), nap(at(dd, 13, 30), at(dd, 15)));
    }
    // About ten months old on either date, so the age norms match.
    const birthDate = change > new Date(2026, 6, 1).getTime() ? '2025-12-25' : '2025-05-29';
    const { items } = suggestedSchedule(logs, { birthDate }, at(day, 7));
    expect(items.map((i) => `${i.kind} ${clock(i.kind === 'nap' ? i.start : i.at)}`)).toEqual(['wake 06:30', 'nap 09:30', 'nap 13:34', 'bedtime 19:30']);
  });
});
