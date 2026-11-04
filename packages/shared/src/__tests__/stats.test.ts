import { describe, expect, it } from 'vitest';
import { addDays, averageStats, dailyStats, dayRange, sleepSegments, solidsReport } from '../domain/stats';
import { entry } from './fixtures';

const H = 3_600_000;
const day0 = new Date(2026, 9, 10).getTime(); // local midnight
const at = (dayOffset: number, hour: number) => addDays(day0, dayOffset) + hour * H;

describe('dailyStats', () => {
  const days = dayRange(addDays(day0, 1), 2);
  const logs = [
    entry({ type: 'sleep', nap: false }, at(0, 20), at(1, 6)), // 4h day 0, 6h day 1
    entry({ type: 'sleep' }, at(1, 13), at(1, 14.5)), // nap by time of day
    entry({ type: 'feed', method: 'bottle', amountMl: 120 }, at(0, 8), at(0, 8)),
    entry({ type: 'feed', method: 'breast', leftSeconds: 600, rightSeconds: 300 }, at(0, 11), at(0, 11.25)),
    entry({ type: 'feed', method: 'solids', foods: ['Pear'] }, at(1, 12), at(1, 12)),
    entry({ type: 'diaper', condition: 'both' }, at(1, 7)),
    entry({ type: 'diaper', condition: 'wet' }, at(1, 9)),
  ];
  const [d0, d1] = dailyStats(logs, days, at(2, 0));

  it('splits sleep across midnight and separates naps from night sleep', () => {
    expect(d0.sleepMs).toBe(4 * H);
    expect(d0.nightMs).toBe(4 * H);
    expect(d1.sleepMs).toBe(7.5 * H);
    expect(d1.napMs).toBe(1.5 * H);
    expect(d1.naps).toBe(1);
  });

  it('counts milk feeds, solids and diapers on the day they started', () => {
    expect(d0).toMatchObject({ feeds: 2, bottleMl: 120, breastSec: 900, solids: 0 });
    expect(d1).toMatchObject({ feeds: 0, solids: 1, diapers: 2, wet: 2, dirty: 1 });
  });

  it('counts a running sleep up to now', () => {
    const running = entry({ type: 'sleep', nap: true }, at(0, 10), null);
    expect(dailyStats([running], [day0], at(0, 11))[0].napMs).toBe(H);
  });

  it('averages only over tracked days', () => {
    const stats = dailyStats(logs, dayRange(addDays(day0, 2), 3), at(3, 0));
    expect(averageStats(stats)).toMatchObject({ days: 2, diapers: 1 });
  });
});

describe('sleepSegments', () => {
  it('clips to the range', () => {
    const s = sleepSegments([entry({ type: 'sleep', nap: false }, at(0, 20), at(1, 6))], day0 + 0, addDays(day0, 1), at(2, 0));
    expect(s).toEqual([expect.objectContaining({ start: at(0, 20), end: addDays(day0, 1), nap: false })]);
  });
});

describe('solidsReport', () => {
  it('merges foods case-insensitively and collects reactions', () => {
    const r = solidsReport([
      entry({ type: 'feed', method: 'solids', foods: ['egg', 'Pear', 'Egg '], reaction: 'Rash', allergen: true }, at(1, 12), at(1, 12)),
      entry({ type: 'feed', method: 'solids', foods: ['Egg'] }, at(0, 12), at(0, 12)),
    ]);
    expect(r[0]).toMatchObject({ name: 'egg', count: 2, firstAt: at(0, 12), reactions: ['Rash'], allergen: true });
    expect(r.map((f) => f.name)).toEqual(['egg', 'Pear']);
  });
});
