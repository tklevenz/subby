import { describe, expect, it } from 'vitest';
import { ageInDays, ageParts, formatAgeLong, nextAgeMilestone } from '../domain/time';

const on = (y: number, m: number, d: number) => new Date(y, m - 1, d, 15).getTime();

describe('calendar age', () => {
  it('counts whole months and remaining days, clamping short months', () => {
    expect(ageParts('2026-01-31', on(2026, 2, 28))).toEqual({ months: 1, days: 0 });
    expect(ageParts('2026-01-31', on(2026, 3, 30))).toEqual({ months: 1, days: 30 });
    expect(ageParts('2026-01-31', on(2026, 3, 31))).toEqual({ months: 2, days: 0 });
    expect(ageParts('2024-07-27', on(2026, 10, 20))).toEqual({ months: 26, days: 23 });
  });

  it('formats by stage', () => {
    expect(formatAgeLong('2026-10-10', on(2026, 10, 20))).toBe('10 days');
    expect(formatAgeLong('2026-09-01', on(2026, 10, 20))).toBe('7 weeks');
    expect(formatAgeLong('2026-02-08', on(2026, 10, 20))).toBe('8 months, 12 days');
    expect(formatAgeLong('2024-07-27', on(2026, 10, 20))).toBe('2 years, 2 months');
    expect(formatAgeLong('2025-10-20', on(2026, 10, 20))).toBe('12 months');
  });
});

describe('nextAgeMilestone', () => {
  it('celebrates months in the first year, then birthdays', () => {
    expect(nextAgeMilestone('2026-02-08', on(2026, 10, 20))).toMatchObject({ label: '9 months', days: 19 });
    expect(nextAgeMilestone('2026-02-20', on(2026, 10, 20))).toMatchObject({ label: '8 months', days: 0 });
    expect(nextAgeMilestone('2024-07-27', on(2026, 10, 20))).toMatchObject({ label: '3 years', days: 280 });
    expect(nextAgeMilestone('2025-10-20', on(2026, 10, 20))).toMatchObject({ label: '1 year', days: 0 });
    expect(nextAgeMilestone('2025-11-25', on(2026, 10, 20))).toMatchObject({ label: '11 months', days: 5 });
    expect(nextAgeMilestone('2025-11-10', on(2026, 10, 20))).toMatchObject({ label: '1 year', days: 21 });
  });
});

describe('ageInDays', () => {
  it('counts whole days across a DST change', () => {
    // Winter birth, summer day: one day is 23 h long in between (in zones with DST).
    expect(ageInDays('2026-01-01', new Date(2026, 6, 1, 12).getTime())).toBe(181);
    expect(ageInDays('2026-07-01', new Date(2026, 11, 1, 0, 30).getTime())).toBe(153);
  });
});

describe('durations', () => {
  it('drops a zero part and, from a minute up, the seconds', async () => {
    const { formatHoursMinutes, formatSpan } = await import('../domain/time');
    expect(formatHoursMinutes(2 * 3600_000)).toBe('2h');
    expect(formatHoursMinutes(150 * 60_000)).toBe('2h 30m');
    expect(formatHoursMinutes(35 * 60_000)).toBe('35m');
    expect(formatSpan(45_000)).toBe('45s');
    expect(formatSpan(12 * 60_000)).toBe('12m');
    expect(formatSpan(55 * 60_000 + 59_000)).toBe('55m');
    expect(formatSpan(89 * 60_000)).toBe('1h 29m');
  });
});
