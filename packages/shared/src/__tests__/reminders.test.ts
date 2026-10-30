import { describe, expect, it } from 'vitest';
import { DEFAULT_REMINDERS, planReminders, type ReminderChild } from '../domain/reminders';

const now = new Date(2026, 9, 20, 12, 0).getTime();
const MIN = 60_000;
const child: ReminderChild = {
  id: 'c1',
  name: 'Emma',
  lastFeedAt: now - 60 * MIN,
  feedRunning: false,
  lastDiaperAt: null,
  lastPumpAt: null,
  timers: [],
  meds: [{ name: 'Ibuprofen', lastAt: now - 2 * 60 * MIN, dueAt: now + 4 * 60 * MIN, last: { type: 'medication', name: 'Ibuprofen', nextDoseIntervalMin: 360 } }],
  nextSleep: { kind: 'nap', earliest: now + 30 * MIN, latest: now + 60 * MIN, basis: 'personal', wakeAt: now - 120 * MIN, napIndex: 1, napMinutes: 75 },
};
const all = {
  ...DEFAULT_REMINDERS,
  feed: { enabled: true, intervalMin: 180 },
  medication: { enabled: true },
  nap: { enabled: true, leadMin: 10 },
};
const fmt = (ms: number) => new Date(ms).toTimeString().slice(0, 5);

describe('planReminders', () => {
  it('plans nothing by default', () => {
    expect(planReminders({ now, settings: DEFAULT_REMINDERS, children: [child], formatTime: fmt })).toEqual([]);
  });

  it('schedules feed, medication and nap reminders in time order', () => {
    const plan = planReminders({ now, settings: all, children: [child], formatTime: fmt });
    expect(plan.map((p) => [p.id, (p.at - now) / MIN])).toEqual([
      ['kl:nap:c1', 20],
      ['kl:feed:c1', 120],
      ['kl:med:c1:ibuprofen', 240],
    ]);
    expect(plan[1].body).toBe("It's been 3h since the last feed started (11:00).");
  });

  it('skips past-due reminders and running feeds', () => {
    const plan = planReminders({
      now,
      settings: all,
      children: [{ ...child, lastFeedAt: now - 200 * MIN, nextSleep: null, meds: [] }, { ...child, id: 'c2', feedRunning: true, nextSleep: null, meds: [] }],
      formatTime: fmt,
    });
    expect(plan).toEqual([]);
  });

  it('medication reminders say to check first when other phones sync without push', () => {
    const med = (checkBeforeDosing?: boolean) =>
      planReminders({ now, settings: all, children: [child], formatTime: fmt, checkBeforeDosing }).find((p) => p.id === 'kl:med:c1:ibuprofen')!.body;
    expect(med()).toBe('Last dose at 10:00.');
    expect(med(true)).toBe('Last dose at 10:00. Open the app first to check nobody else has given it.');
  });

  it('the master switch pauses everything', () => {
    expect(planReminders({ now, settings: { ...all, enabled: false }, children: [child], formatTime: fmt })).toEqual([]);
  });

  it('diaper and pumping intervals; no pumping reminder while pumping', () => {
    const settings = { ...DEFAULT_REMINDERS, diaper: { enabled: true, intervalMin: 120 }, pumping: { enabled: true, intervalMin: 180 } };
    const c = { ...child, lastDiaperAt: now - 30 * MIN, lastPumpAt: now - 60 * MIN };
    expect(planReminders({ now, settings, children: [c], formatTime: fmt }).map((p) => [p.id, (p.at - now) / MIN])).toEqual([
      ['kl:diaper:c1', 90],
      ['kl:pumping:c1', 120],
    ]);
    const pumping = { ...c, timers: [{ id: 'p1', type: 'pumping' as const, startedAt: now - 5 * MIN }] };
    expect(planReminders({ now, settings, children: [pumping], formatTime: fmt }).map((p) => p.id)).toEqual(['kl:diaper:c1']);
  });

  it('flags forgotten timers by type', () => {
    const settings = { ...DEFAULT_REMINDERS, timers: { enabled: true } };
    const c = {
      ...child,
      timers: [
        { id: 'f1', type: 'feed' as const, startedAt: now - 10 * MIN },
        { id: 's1', type: 'sleep' as const, startedAt: now - 60 * MIN, nap: true },
        { id: 's2', type: 'sleep' as const, startedAt: now - 60 * MIN, nap: false },
      ],
    };
    const plan = planReminders({ now, settings, children: [c], formatTime: fmt });
    expect(plan.map((p) => [p.id, (p.at - now) / MIN, p.entryId])).toEqual([
      ['kl:timer:f1', 50, 'f1'],
      ['kl:timer:s1', 120, 's1'],
      ['kl:timer:s2', 13 * 60, 's2'],
    ]);
    expect(plan[0].title).toBe("Is Emma's feed still going?");
  });
});
