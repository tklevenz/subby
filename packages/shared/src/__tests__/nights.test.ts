import { describe, expect, it } from 'vitest';
import { averageNights, groupNights, nightOf, nightPieces, nightsByDay } from '../domain/nights';
import { addDays } from '../domain/stats';
import { entry } from './fixtures';

const MIN = 60_000;
const day = new Date(2026, 9, 20).getTime();
const at = (d: number, h: number, m = 0) => addDays(day, d) + (h * 60 + m) * MIN;

describe('nights', () => {
  const a = entry({ type: 'sleep', nap: false }, at(-1, 19, 40), at(0, 1, 10));
  const b = entry({ type: 'sleep', nap: false }, at(0, 1, 35), at(0, 4, 45));
  const c = entry({ type: 'sleep', nap: false }, at(0, 5, 25), at(0, 6, 50));
  const nap = entry({ type: 'sleep', nap: true }, at(0, 9, 30), at(0, 10, 30));
  const next = entry({ type: 'sleep', nap: false }, at(0, 19, 30), null);

  it('groups night sleeps less than 3 h apart, naps aside', () => {
    const nights = groupNights([next, nap, c, a, b], at(0, 21));
    expect(nights).toHaveLength(2);
    expect(nights[0]).toMatchObject({
      start: at(-1, 19, 40),
      end: at(0, 6, 50),
      wakings: [{ start: at(0, 1, 10), end: at(0, 1, 35) }, { start: at(0, 4, 45), end: at(0, 5, 25) }],
      asleepMs: (330 + 190 + 85) * MIN,
      longestMs: 330 * MIN,
    });
    expect(nights[1]).toMatchObject({ end: null, asleepMs: 90 * MIN });
    expect(nightOf(nights, b.id)).toBe(nights[0]);
  });

  it('turns bedtime, wake-up and wakings into pieces, or null when they don’t fit', () => {
    const bed = at(-1, 19, 40);
    const up = at(0, 6, 50);
    const w = (h: number, m: number, len: number) => ({ start: at(0, h, m), end: at(0, h, m) + len * MIN });
    expect(nightPieces(bed, up, [w(4, 45, 40), w(1, 10, 25)])).toEqual([
      { start: bed, end: at(0, 1, 10) },
      { start: at(0, 1, 35), end: at(0, 4, 45) },
      { start: at(0, 5, 25), end: up },
    ]);
    expect(nightPieces(bed, up, [])).toEqual([{ start: bed, end: up }]);
    expect(nightPieces(bed, up, [w(6, 40, 20)])).toBeNull();
    expect(nightPieces(bed, up, [w(1, 0, 30), w(1, 20, 30)])).toBeNull();
    expect(nightPieces(bed, up, [{ start: at(0, 2), end: at(0, 2) }])).toBeNull();
  });

  it('gives each day the night that ended that morning, and averages them', () => {
    const per = nightsByDay(groupNights([a, b, c, next], at(0, 21)), [addDays(day, -1), day]);
    expect(per[0]).toBeNull();
    expect(per[1]).toEqual({ asleepMs: 605 * MIN, awakeMs: 65 * MIN, wakings: 2, longestMs: 330 * MIN });
    expect(averageNights(per)).toMatchObject({ wakings: 2, nights: 1 });
    expect(averageNights([null])).toBeNull();
  });
});
