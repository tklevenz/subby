import { describe, expect, it } from 'vitest';
import { DEFAULT_FAMILY_ALERTS, FAMILY_ALERT_ID_PREFIX, familyAlerts, type PulledChange } from '../domain/familyAlerts';
import { addDays } from '../domain/stats';
import type { LogEntry } from '../schemas/log.schema';
import { entry } from './fixtures';

const MIN = 60_000;
const day = new Date(2026, 9, 20).getTime();
const at = (d: number, h: number, m = 0) => addDays(day, d) + (h * 60 + m) * MIN;
const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Seven usual nights (19:30–06:30) before `d`, so the usual wake-up is known. */
const history = (d: number) =>
  Array.from({ length: 7 }, (_, i) => entry({ type: 'sleep', nap: false }, at(d - 8 + i, 19, 30), at(d - 7 + i, 6, 30)));

function run(changes: PulledChange[], now: number, sleeps: LogEntry[], settings = { ...DEFAULT_FAMILY_ALERTS, enabled: true }) {
  return familyAlerts({ changes, settings, allowed: true, sleeps: () => sleeps, childName: () => 'Emma', now, formatTime: hhmm });
}
const id = (e: LogEntry) => `${FAMILY_ALERT_ID_PREFIX}sleep:${e.id}`;
const ended = (e: LogEntry, endedAt: number): LogEntry => ({ ...e, endedAt });

describe('familyAlerts', () => {
  it('tells when a nap starts, then replaces it when they wake', () => {
    const nap = entry({ type: 'sleep', nap: true }, at(0, 13, 42), null);
    expect(run([{ before: null, after: nap, by: 'Pixel 10' }], at(0, 13, 43), [nap])).toEqual([
      { kind: 'show', id: id(nap), title: 'Emma fell asleep', body: 'Nap since 13:42 · logged on Pixel 10', childId: nap.childId },
    ]);
    const up = ended(nap, at(0, 15, 2));
    expect(run([{ before: nap, after: up, by: 'Pixel 10' }], at(0, 15, 3), [up])).toEqual([
      { kind: 'show', id: id(nap), title: 'Emma woke up', body: 'Napped 1h 20m · logged on Pixel 10', childId: nap.childId },
    ]);
    // Without wake-ups, the "asleep" one goes away instead.
    expect(run([{ before: nap, after: up, by: 'x' }], at(0, 15, 3), [up], { enabled: true, wakeUps: false, nights: false, medications: false })).toEqual([
      { kind: 'dismiss', id: id(nap) },
    ]);
  });

  it('withdraws an undone sleep, and stays quiet when off, late or logged afterwards', () => {
    const nap = entry({ type: 'sleep', nap: true }, at(0, 13, 42), null);
    expect(run([{ before: nap, after: { ...nap, isDeleted: true, payload: { type: 'sleep' } }, by: 'x' }], at(0, 13, 43), [])).toEqual([
      { kind: 'dismiss', id: id(nap) },
    ]);
    expect(run([{ before: null, after: nap, by: 'x' }], at(0, 13, 43), [nap], DEFAULT_FAMILY_ALERTS)).toEqual([]);
    expect(run([{ before: null, after: nap, by: 'x' }], at(0, 14, 0), [nap])).toEqual([]);
    const done = ended(nap, at(0, 15));
    expect(run([{ before: null, after: done, by: 'x' }], at(0, 15), [done])).toEqual([]);
  });

  it('tells about nights only when asked, and never about night wakings', () => {
    const nights = { enabled: true, wakeUps: true, nights: true, medications: false };
    const past = history(0);
    const bed = entry({ type: 'sleep', nap: false }, at(0, 19, 30), null);
    expect(run([{ before: null, after: bed, by: 'x' }], at(0, 19, 31), [...past, bed])).toEqual([]);
    expect(run([{ before: null, after: bed, by: 'x' }], at(0, 19, 31), [...past, bed], nights)).toMatchObject([
      { kind: 'show', id: id(bed), title: 'Emma is down for the night' },
    ]);

    // Up at 01:10: not the morning, so nothing.
    const first = ended(bed, at(1, 1, 10));
    expect(run([{ before: bed, after: first, by: 'x' }], at(1, 1, 11), [...past, first], nights)).toEqual([]);
    // Back asleep at 01:35: the same night.
    const second = entry({ type: 'sleep', nap: false }, at(1, 1, 35), null);
    expect(run([{ before: null, after: second, by: 'x' }], at(1, 1, 36), [...past, first, second], nights)).toEqual([]);
    // Up and back asleep, both in one pull: still the same night, no "woke up".
    expect(run([{ before: bed, after: first, by: 'x' }, { before: null, after: second, by: 'x' }], at(1, 1, 36), [...past, first, second], nights)).toEqual([]);
    // The morning: replaces the night's notification, counting the whole night.
    const morning = ended(second, at(1, 6, 35));
    expect(run([{ before: second, after: morning, by: 'x' }], at(1, 6, 36), [...past, first, morning], nights)).toEqual([
      { kind: 'show', id: id(bed), title: 'Emma woke up', body: 'Slept 10h 40m · logged on x', childId: bed.childId },
    ]);
  });
});

describe('medication given on another phone', () => {
  const settings = { ...DEFAULT_FAMILY_ALERTS, medications: true };
  const medRun = (changes: PulledChange[], now: number, s = settings) =>
    familyAlerts({ changes, settings: s, allowed: true, sleeps: () => [], childName: () => 'Emma', now, formatTime: hhmm });
  const dose = (startedAt: number, loggedAt = startedAt) => ({ ...entry({ type: 'medication', name: 'Paracetamol', dose: 2.5, unit: 'ml' }, startedAt), updatedAt: loggedAt });
  const medId = (e: LogEntry) => `${FAMILY_ALERT_ID_PREFIX}medication:${e.id}`;

  it('tells about a new dose, with or without sleep alerts on', () => {
    const d = dose(at(0, 14, 5));
    expect(medRun([{ before: null, after: d, by: 'Pixel 9' }], at(0, 14, 6))).toEqual([
      { kind: 'show', id: medId(d), title: 'Emma got Paracetamol', body: '2.5 ml at 14:05 · logged on Pixel 9', childId: d.childId },
    ]);
    const plain = { ...entry({ type: 'medication', name: 'Vitamin D' }, at(0, 8, 40)), updatedAt: at(0, 8, 41) };
    expect(medRun([{ before: null, after: plain, by: 'Pixel 9' }], at(0, 8, 42))[0]).toMatchObject({ title: 'Emma got Vitamin D', body: 'At 08:40 · logged on Pixel 9' });
  });

  it('stays quiet when off, for edits, old news and doses long ago; a deleted dose is withdrawn', () => {
    const d = dose(at(0, 14, 5));
    expect(medRun([{ before: null, after: d, by: 'x' }], at(0, 14, 6), DEFAULT_FAMILY_ALERTS)).toEqual([]);
    expect(medRun([{ before: d, after: { ...d, updatedAt: at(0, 14, 7) }, by: 'x' }], at(0, 14, 8))).toEqual([]);
    expect(medRun([{ before: null, after: d, by: 'x' }], at(0, 14, 30))).toEqual([]); // the pull came late
    expect(medRun([{ before: null, after: dose(at(0, 1), at(0, 14, 5)), by: 'x' }], at(0, 14, 6))).toEqual([]); // backdated 13 h
    expect(medRun([{ before: d, after: { ...d, isDeleted: true }, by: 'x' }], at(0, 14, 9))).toEqual([{ kind: 'dismiss', id: medId(d) }]);
  });
});
