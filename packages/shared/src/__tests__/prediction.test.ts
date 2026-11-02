import { describe, expect, it } from 'vitest';
import { ageNorms, defaultNap, isNightWaking, predictNextSleep, sleepHabits, suggestedSchedule, wakeWindows } from '../domain/prediction';
import { addDays } from '../domain/stats';
import { entry } from './fixtures';

const MIN = 60_000;
const today = new Date(2026, 9, 20).getTime();
const at = (day: number, h: number, m = 0) => addDays(today, day) + (h * 60 + m) * MIN;
// About 8 months old.
const child = { birthDate: '2026-02-15' };

/** A regular 2-nap day: wake 07:00, naps 09:30–10:30 and 13:30–15:00, bed 19:30. */
function week(days: number) {
  const logs = [];
  for (let d = -days; d < 0; d++) {
    logs.push(entry({ type: 'sleep', nap: false }, at(d - 1, 19, 30), at(d, 7)));
    logs.push(entry({ type: 'sleep', nap: true }, at(d, 9, 30), at(d, 10, 30)));
    logs.push(entry({ type: 'sleep', nap: true }, at(d, 13, 30), at(d, 15)));
  }
  logs.push(entry({ type: 'sleep', nap: false }, at(-1, 19, 30), at(0, 7)));
  return logs;
}

describe('sleep habits', () => {
  it('measures wake windows by nap index', () => {
    const w = wakeWindows(week(7), at(-7, 0));
    expect(w.filter((x) => x.index === 0 && !x.beforeNight).every((x) => x.minutes === 150)).toBe(true);
    expect(w.filter((x) => x.beforeNight).every((x) => x.minutes === 270)).toBe(true);
  });

  it('summarizes the last 7 days', () => {
    const h = sleepHabits(week(7), at(0, 8));
    expect(h.napWindows.get(0)).toBe(150);
    expect(h.napWindows.get(1)).toBe(180);
    expect(h.bedtimeWindow).toBe(270);
    expect(h.bedtimeClock).toBe(19.5 * 60);
    expect(h.wakeClock).toBe(7 * 60);
    expect(h.napLengths.get(1)).toBe(90);
    expect(h.napLength).toBe(75);
    expect(h.napsPerDay).toBe(2);
  });
});

describe('predictNextSleep', () => {
  it('blends the personal window with the age norm', () => {
    const p = predictNextSleep(week(7), child, at(0, 8))!;
    const norms = ageNorms(8);
    const center = 150 * 0.7 + ((norms.wakeMin + norms.wakeMax) / 2) * 0.3;
    expect(p).toMatchObject({ kind: 'nap', basis: 'personal', napIndex: 0, napMinutes: 60 });
    expect(p.earliest).toBe(at(0, 7) + (center - 30) * MIN);
  });

  it('predicts bedtime after the usual number of naps', () => {
    const logs = [
      ...week(7),
      entry({ type: 'sleep', nap: true }, at(0, 9, 30), at(0, 10, 30)),
      entry({ type: 'sleep', nap: true }, at(0, 13, 30), at(0, 15)),
    ];
    const p = predictNextSleep(logs, child, at(0, 16))!;
    expect(p).toMatchObject({ kind: 'bedtime', earliest: at(0, 19), latest: at(0, 20) });
  });

  it('moves on to bedtime once the nap window has passed', () => {
    const p = predictNextSleep(week(7), child, at(0, 16))!;
    expect(p.kind).toBe('bedtime');
  });

  it('learns that naps are not taken (or not logged)', () => {
    const nightsOnly = week(7).filter((l) => l.payload.type === 'sleep' && l.payload.nap === false);
    expect(sleepHabits(nightsOnly, at(0, 8)).napsPerDay).toBe(0);
    expect(predictNextSleep(nightsOnly, child, at(0, 8))).toMatchObject({ kind: 'bedtime', earliest: at(0, 19) });
  });

  it('keeps a nap that only some days have', () => {
    // A nap on 2 of the 6 complete days (≥ 30 %; the median is 0): still part of the day, so the morning predicts it.
    const napDays = [at(-6, 9, 30), at(-3, 9, 30)];
    const some = week(7).filter((l) => l.payload.type === 'sleep' && (l.payload.nap === false || napDays.includes(l.startedAt)));
    expect(sleepHabits(some, at(0, 8)).napsPerDay).toBe(1);
    expect(predictNextSleep(some, child, at(0, 8))).toMatchObject({ kind: 'nap', napIndex: 0 });
  });

  it('falls back to age norms without history', () => {
    const p = predictNextSleep([entry({ type: 'sleep', nap: false }, at(-1, 20), at(0, 7))], child, at(0, 8))!;
    const n = ageNorms(8);
    expect(p).toMatchObject({ kind: 'nap', basis: 'age', earliest: at(0, 7) + n.wakeMin * MIN, latest: at(0, 7) + n.wakeMax * MIN });
  });

  it('is null while asleep, after a night waking, or without a recent wake-up', () => {
    expect(predictNextSleep([...week(7), entry({ type: 'sleep', nap: true }, at(0, 9), null)], child, at(0, 10))).toBeNull();
    expect(predictNextSleep([entry({ type: 'sleep', nap: false }, at(-1, 20), at(0, 2))], child, at(0, 2, 10))).toBeNull();
    expect(predictNextSleep(week(7), child, at(0, 20))).toBeNull();
  });
});

describe('suggestedSchedule', () => {
  it('lays out the day from the habits', () => {
    const { items, basis } = suggestedSchedule(week(7), child, at(0, 8));
    expect(basis).toBe('personal');
    expect(items.map((i) => i.kind)).toEqual(['wake', 'nap', 'nap', 'bedtime']);
    expect(items[0]).toEqual({ kind: 'wake', at: at(0, 7), logged: true });
    expect(items[3]).toEqual({ kind: 'bedtime', at: at(0, 19, 30) });
  });

  it("uses today's logged naps and predicts the rest from the last one", () => {
    // Nap 1 ran late and short: 11:00–11:30, instead of 09:30–10:30.
    const logs = [...week(7), entry({ type: 'sleep', nap: true }, at(0, 11), at(0, 11, 30))];
    const { items } = suggestedSchedule(logs, child, at(0, 12));
    expect(items[1]).toEqual({ kind: 'nap', start: at(0, 11), end: at(0, 11, 30), index: 0, logged: true });
    // Nap 2's usual window (180 min) blended with the age norm (157.5 min): 173.25 min after 11:30.
    expect(items[2]).toMatchObject({ kind: 'nap', index: 1, start: at(0, 11, 30) + 173.25 * MIN });
    expect(items[2]).not.toHaveProperty('logged');
    expect(items.at(-1)).toEqual({ kind: 'bedtime', at: at(0, 19, 30) });
  });

  it('shows a running nap until its usual length, and a started night as bedtime', () => {
    const running = [...week(7), entry({ type: 'sleep', nap: true }, at(0, 9, 30), null)];
    expect(suggestedSchedule(running, child, at(0, 9, 45)).items[1]).toEqual({
      kind: 'nap', start: at(0, 9, 30), end: at(0, 10, 30), index: 0, logged: true, running: true,
    });
    const night = [...week(7), entry({ type: 'sleep', nap: true }, at(0, 9, 30), at(0, 10, 30)), entry({ type: 'sleep', nap: false }, at(0, 18, 45), null)];
    const { items } = suggestedSchedule(night, child, at(0, 19));
    expect(items.map((i) => i.kind)).toEqual(['wake', 'nap', 'bedtime']);
    expect(items[2]).toEqual({ kind: 'bedtime', at: at(0, 18, 45), logged: true });
  });

  it('leaves out a nap that would run into bedtime', () => {
    // One late nap until 16:30: nap 2 would start ~19:20, past the usual bedtime minus 90 min.
    const logs = [...week(7), entry({ type: 'sleep', nap: true }, at(0, 15), at(0, 16, 30))];
    expect(suggestedSchedule(logs, child, at(0, 17)).items.map((i) => i.kind)).toEqual(['wake', 'nap', 'bedtime']);
  });

  it('starts from the usual wake-up while still asleep after a night waking', () => {
    const logs = [...week(7).slice(0, -1), entry({ type: 'sleep', nap: false }, at(-1, 19, 30), at(0, 2)), entry({ type: 'sleep', nap: false }, at(0, 2, 30), null)];
    expect(suggestedSchedule(logs, child, at(0, 5)).items[0]).toEqual({ kind: 'wake', at: at(0, 7) });
  });
});

describe('night wakings', () => {
  it('treats night sleep logged in pieces as one night', () => {
    const logs = week(7).flatMap((l) => {
      if (l.payload.type !== 'sleep' || l.payload.nap !== false) return [l];
      // Split each night with a 30 min waking at 01:00.
      const oneAm = startOfNight(l.endedAt!) + 60 * MIN;
      return [entry({ type: 'sleep', nap: false }, l.startedAt, oneAm), entry({ type: 'sleep', nap: false }, oneAm + 30 * MIN, l.endedAt)];
    });
    const h = sleepHabits(logs, at(0, 8));
    expect(h.bedtimeClock).toBe(19.5 * 60);
    expect(h.wakeClock).toBe(7 * 60);
    expect(h.bedtimeWindow).toBe(270);
  });
});

describe('awake in the night', () => {
  // The usual night is 19:30–07:00; tonight ended early, at 04:00.
  const early = [...week(7).slice(0, -1), entry({ type: 'sleep', nap: false }, at(-1, 19, 30), at(0, 4))];

  it('is a night waking until the usual morning, or 3 h at most', () => {
    expect(isNightWaking(early, at(0, 4, 20))).toBe(true);
    expect(predictNextSleep(early, child, at(0, 4, 20))).toBeNull();
    // 3 h on, before 07:00: it was the day's start, and nap 1 is predicted from 04:00.
    expect(isNightWaking(early, at(0, 7, 1))).toBe(false);
    expect(predictNextSleep(early, child, at(0, 7, 1))).toMatchObject({ kind: 'nap', napIndex: 0, wakeAt: at(0, 4) });
    expect(suggestedSchedule(early, child, at(0, 7, 1)).items[0]).toEqual({ kind: 'wake', at: at(0, 4), logged: true });
  });

  it('counts a waking just after bedtime too, and not a late morning', () => {
    const late = [...week(7), entry({ type: 'sleep', nap: false }, at(0, 19, 30), at(0, 23, 30))];
    expect(isNightWaking(late, at(0, 23, 45))).toBe(true);
    expect(isNightWaking(week(7), at(0, 7, 15))).toBe(false);
  });
});

const startOfNight = (wake: number) => new Date(new Date(wake).setHours(0, 0, 0, 0)).getTime();

describe('defaultNap', () => {
  it('makes a sleep from an hour before the usual bedtime a night, not a nap', () => {
    const nights = Array.from({ length: 7 }, (_, i) => entry({ type: 'sleep', nap: false }, at(-8 + i, 19, 40), at(-7 + i, 7, 0)));
    expect(defaultNap(nights, at(0, 18, 49))).toBe(false);
    expect(defaultNap(nights, at(0, 18, 30))).toBe(true);
    expect(defaultNap(nights, at(0, 13, 0))).toBe(true);
    expect(defaultNap(nights, at(1, 5, 30))).toBe(false);
    expect(defaultNap(nights, at(1, 9, 0))).toBe(true);
    // Without habits: the clock.
    expect(defaultNap([], at(0, 18, 49))).toBe(true);
    expect(defaultNap([], at(0, 19, 10))).toBe(false);
  });
});
