import { describe, expect, it } from 'vitest';
import { formatPercentile, growthAgeMonths, growthPercentile, growthPoints, lmsAt, normalCdf, percentileCurves, valueAtZ, zScore } from '../domain/growth';
import { entry } from './fixtures';

describe('WHO LMS', () => {
  it('matches the published -2 SD value (boys, weight, birth)', () => {
    expect(valueAtZ(-2, lmsAt('weightKg', 'male', 0)!)).toBeCloseTo(2.459312, 4);
  });

  it('the median is the 50th percentile', () => {
    const lms = lmsAt('lengthCm', 'female', 6)!;
    expect(zScore(lms[1], lms)).toBeCloseTo(0, 9);
    expect(growthPercentile('lengthCm', 'female', 6, lms[1])).toBeCloseTo(50, 5);
  });

  it('interpolates between months and is null outside 0–24', () => {
    const [a, b] = [lmsAt('headCm', 'male', 3)!, lmsAt('headCm', 'male', 4)!];
    expect(lmsAt('headCm', 'male', 3.5)![1]).toBeCloseTo((a[1] + b[1]) / 2, 9);
    expect(lmsAt('headCm', 'male', 25)).toBeNull();
    expect(growthPercentile('weightKg', 'other', 3, 6)).toBeNull();
    expect(growthPercentile('weightKg', 'female', 3, 0)).toBeNull();
  });

  it('normal CDF', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.880794)).toBeCloseTo(0.97, 4);
    expect(normalCdf(-1.880794)).toBeCloseTo(0.03, 4);
  });

  it('curves are ordered', () => {
    const curves = percentileCurves('weightKg', 'female');
    const at12 = curves.map((c) => c.points.find((p) => p.months === 12)!.value);
    expect([...at12].sort((x, y) => x - y)).toEqual(at12);
  });
});

describe('growth helpers', () => {
  it('measures age from the birth date (across a DST change)', () => {
    const at = new Date(2026, 3, 1).getTime();
    expect(growthAgeMonths({ birthDate: '2026-01-01' }, at)).toBeCloseTo(90 / 30.4375, 6);
  });

  it('extracts points in chart units', () => {
    const logs = [entry({ type: 'growth', weightG: 5000, headCm: 40 }, new Date(2026, 2, 1).getTime())];
    expect(growthPoints(logs, { birthDate: '2026-01-01' }, 'weightKg')[0].value).toBe(5);
    expect(growthPoints(logs, { birthDate: '2026-01-01' }, 'lengthCm')).toEqual([]);
  });

  it('formats percentiles', () => {
    expect(formatPercentile(50.2)).toBe('50th');
    expect(formatPercentile(1.04)).toBe('1st');
    expect(formatPercentile(22)).toBe('22nd');
    expect(formatPercentile(12)).toBe('12th');
    expect(formatPercentile(99.95)).toBe('>99.9th');
  });
});
