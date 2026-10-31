import { describe, expect, it } from 'vitest';
import { dayTimeline } from '../domain/timeline';
import { entry } from './fixtures';

const H = 3_600_000;
const day = new Date(2026, 9, 26).getTime();
const at = (h: number) => day + h * H;

describe('dayTimeline', () => {
  const night = entry({ type: 'sleep', nap: false }, at(-4.33), at(6.58));
  const feed = entry({ type: 'feed', method: 'bottle', amountMl: 150 }, at(9.67), at(9.67));
  const nap1 = entry({ type: 'sleep', nap: true }, at(8.33), at(9.58));
  const nap2 = entry({ type: 'sleep', nap: true }, at(12.75), at(14.08));
  const diaper = entry({ type: 'diaper', condition: 'wet' }, at(14.17));
  const yesterday = entry({ type: 'diaper', condition: 'dirty' }, at(-6));
  const logs = [night, feed, nap1, nap2, diaper, yesterday];
  const shape = (now: number) =>
    dayTimeline(logs, day, now).map((i) =>
      i.kind === 'entry' ? i.entry.id : i.kind === 'night' ? 'night' : `awake ${(i.to - i.from) / H}h${i.ongoing ? ' so far' : ''}`,
    );

  it("lists the day's entries newest first, with the night that ran into it", () => {
    const items = shape(at(14.33));
    expect(items).not.toContain(yesterday.id);
    expect(items.at(-1)).toBe(night.id);
  });

  it('puts each wake window right below the sleep that ended it, and the current one first', () => {
    const items = shape(at(14.33));
    expect(items[0]).toMatch(/^awake 0\.25.*so far$/);
    expect(items.slice(1)).toEqual([
      diaper.id,
      nap2.id,
      expect.stringMatching(/^awake 3\.1/),
      feed.id,
      nap1.id,
      expect.stringMatching(/^awake 1\.75/),
      night.id,
    ]);
  });

  it('has no current wake window while a sleep runs, or on past days', () => {
    const running = entry({ type: 'sleep', nap: true }, at(14.25), null);
    const items = dayTimeline([...logs, running], day, at(14.5));
    expect(items.some((i) => i.kind === 'awake' && i.ongoing)).toBe(false);
    expect(dayTimeline(logs, day, at(30)).some((i) => i.kind === 'awake' && i.ongoing)).toBe(false);
  });

  it('shows a night with wakings as one block, without the wake windows inside it', () => {
    const a = entry({ type: 'sleep', nap: false }, at(-4.33), at(1.17));
    const b = entry({ type: 'sleep', nap: false }, at(1.58), at(6.58));
    const bottle = entry({ type: 'feed', method: 'bottle', amountMl: 90 }, at(1.33), at(1.33));
    const items = dayTimeline([a, b, bottle, nap1], day, at(10));
    const nights = items.filter((i) => i.kind === 'night');
    expect(nights).toHaveLength(1);
    expect(items.at(-1)).toMatchObject({ kind: 'night', night: { start: at(-4.33), end: at(6.58) } });
    expect(items.flatMap((i) => (i.kind === 'awake' ? [(i.to - i.from) / H] : []))).toEqual([0.42, 1.75]);
    expect(items.some((i) => i.kind === 'entry' && i.entry.id === bottle.id)).toBe(true);
  });
});
