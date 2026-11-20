import { describe, expect, it } from 'vitest';
import { mergedSleep, sleepConflicts } from '../domain/sleepConflicts';
import type { LogEntry } from '../schemas/log.schema';
import { entry } from './fixtures';

const MIN = 60_000;
const t0 = new Date(2026, 10, 19, 20, 0).getTime();
const at = (m: number) => t0 + m * MIN;
const sleep = (start: number, end: number | null, notes?: string) => entry({ type: 'sleep', nap: false, ...(notes ? { notes } : {}) }, start, end);

describe('sleep conflicts', () => {
  it('pairs two sleeps logged at once on two phones, keeping the one created first', () => {
    const first = sleep(at(29), null); // created first: the lower id
    const second = sleep(at(30), null);
    const [c] = sleepConflicts([second, first], at(0));
    expect(c?.keep.id).toBe(first.id);
    expect(c?.drop.id).toBe(second.id);
    // The same pair, whichever order the phone holds them in.
    expect(sleepConflicts([first, second], at(0))[0]?.key).toBe(c?.key);
  });

  it('ignores touching pieces, other children, deleted and older sleeps, and other types', () => {
    const a = sleep(at(0), at(60));
    const b = sleep(at(60), at(120)); // a night's next piece
    const other = { ...sleep(at(10), at(50)), childId: '0190a000-0000-7000-8000-00000000ffff' };
    const deleted = { ...sleep(at(10), at(50)), isDeleted: true };
    const old = sleep(at(-600), at(-500));
    const older = sleep(at(-560), at(-520));
    const feed = entry({ type: 'feed', method: 'bottle' }, at(10), at(10)) as LogEntry;
    expect(sleepConflicts([a, b, other, deleted, old, older, feed], at(-60))).toEqual([]);
    expect(sleepConflicts([old, older], at(-600))).toHaveLength(1);
  });

  it('puts each sleep in at most one pair', () => {
    const a = sleep(at(0), null);
    const b = sleep(at(1), null);
    const c = sleep(at(2), null);
    expect(sleepConflicts([a, b, c], at(0))).toHaveLength(1);
  });

  it('merges into the earlier start, the logged end, and both notes', () => {
    const keep = sleep(at(29), null, 'in the pram');
    const drop = sleep(at(30), at(120), 'woke up crying');
    const [c] = sleepConflicts([keep, drop], at(0));
    expect(mergedSleep(c!)).toEqual({ startedAt: at(29), endedAt: at(120), payload: { type: 'sleep', nap: false, notes: 'in the pram\nwoke up crying' } });
  });

  it('keeps the later end when both ended, and stays running when neither did', () => {
    const [ended] = sleepConflicts([sleep(at(0), at(90)), sleep(at(5), at(80))], at(0));
    expect(mergedSleep(ended!)).toMatchObject({ startedAt: at(0), endedAt: at(90) });
    const [running] = sleepConflicts([sleep(at(0), null, 'same'), sleep(at(1), null, 'same')], at(0));
    expect(mergedSleep(running!)).toMatchObject({ endedAt: null, payload: { notes: 'same' } });
  });
});
