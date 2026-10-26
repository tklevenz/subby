import { describe, expect, it } from 'vitest';
import { dayOptions, daysInMonth, from12, joinTime, monthGrid, splitTime, to12 } from './parts';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m, d, h, min).getTime();

describe('date wheel parts', () => {
  const now = at(2026, 9, 26, 12, 45);

  it('lists a year of days ending today, oldest first', () => {
    const days = dayOptions(now, now);
    expect(days).toHaveLength(366);
    expect(days.at(-1)).toBe(at(2026, 9, 26));
    expect(days[0]).toBe(at(2025, 9, 26));
  });

  it('reaches back to an older value, and forward to a later maximum', () => {
    expect(dayOptions(at(2024, 0, 15, 9), now)[0]).toBe(at(2024, 0, 15));
    expect(dayOptions(now, now, at(2026, 9, 28)).at(-1)).toBe(at(2026, 9, 28));
  });

  it('counts calendar days across the DST change', () => {
    // Europe/Berlin falls back on 2026-10-25; every entry is still a local midnight.
    const days = dayOptions(at(2026, 9, 20), at(2026, 9, 27));
    expect(days.every((d) => new Date(d).getHours() === 0)).toBe(true);
  });

  it('splits and joins times', () => {
    const t = at(2026, 9, 25, 23, 5);
    expect(splitTime(t)).toEqual({ day: at(2026, 9, 25), hour: 23, minute: 5 });
    expect(joinTime(at(2026, 9, 25), 23, 5)).toBe(t);
  });

  it('converts 12-hour clock values', () => {
    expect(to12(0)).toEqual({ hour12: 12, pm: false });
    expect(to12(12)).toEqual({ hour12: 12, pm: true });
    expect(to12(15)).toEqual({ hour12: 3, pm: true });
    expect([from12(12, false), from12(12, true), from12(3, true), from12(11, false)]).toEqual([0, 12, 15, 11]);
  });

  it('knows month lengths', () => {
    expect([daysInMonth(2024, 1), daysInMonth(2026, 1), daysInMonth(2026, 3)]).toEqual([29, 28, 30]);
  });

  it('lays a month out in Monday-first weeks', () => {
    const oct = monthGrid(2026, 9); // Oct 1, 2026 is a Thursday
    expect(oct[0]!.slice(0, 3)).toEqual([null, null, null]);
    expect(oct[0]![3]).toBe(at(2026, 9, 1));
    expect(oct.every((w) => w.length === 7)).toBe(true);
    expect(oct.flat().filter((d) => d !== null)).toHaveLength(31);
    expect(oct.flat().filter((d) => d !== null).every((d) => new Date(d!).getHours() === 0)).toBe(true);
    expect(monthGrid(2026, 1)[0]![6]).toBe(at(2026, 1, 1)); // Feb 1, 2026 is a Sunday
  });
});
