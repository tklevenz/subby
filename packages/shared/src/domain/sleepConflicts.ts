import type { LogEntry } from '../schemas/log.schema';
import { isSleepEntry, type SleepEntry } from './nights';

/**
 * Two sleeps of one child at the same time. A phone never logs that itself (the log sheet and the edit screen refuse
 * overlaps), so it comes from two phones logging the same sleep before either saw the other's (LAUNCH.md A16).
 * `keep` is the one created first (UUIDv7 ids sort by creation): every phone picks the same, so two parents
 * merging at once end up with the same entry instead of each deleting a different one.
 */
export type SleepConflict = { keep: SleepEntry; drop: SleepEntry; key: string };

/**
 * Overlapping pairs among a child's live sleeps that started from `since` on, oldest first, each sleep in at most
 * one pair (after a merge, any third one shows up as the next pair). Running sleeps last until stopped; touching
 * ends (a night's pieces) don't overlap.
 */
export function sleepConflicts(logs: LogEntry[], since: number): SleepConflict[] {
  const sleeps = logs.filter((l): l is SleepEntry => isSleepEntry(l) && l.startedAt >= since).sort((a, b) => a.startedAt - b.startedAt || cmp(a.id, b.id));
  const used = new Set<string>();
  const found: SleepConflict[] = [];
  for (let i = 0; i < sleeps.length; i++) {
    const a = sleeps[i]!;
    if (used.has(a.id)) continue;
    for (let j = i + 1; j < sleeps.length; j++) {
      const b = sleeps[j]!;
      if (b.startedAt >= (a.endedAt ?? Infinity)) break; // sorted by start: nothing later overlaps `a` either
      if (used.has(b.id) || b.childId !== a.childId) continue;
      const [keep, drop] = cmp(a.id, b.id) < 0 ? [a, b] : [b, a];
      found.push({ keep, drop, key: `${keep.id}|${drop.id}` });
      used.add(a.id).add(b.id);
      break;
    }
  }
  return found;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The kept sleep with the other folded in: the earlier start, and the end someone actually logged (the later of
 * two, or the only one: whoever tapped "woke up" is right even if the other phone's copy still runs). Notes are
 * joined. Pure and order-independent, so every phone merging the same pair writes the same entry.
 */
export function mergedSleep({ keep, drop }: SleepConflict): Pick<SleepEntry, 'startedAt' | 'endedAt' | 'payload'> {
  const ends = [keep.endedAt, drop.endedAt].filter((e): e is number => e !== null);
  const notes = [keep.payload.notes?.trim(), drop.payload.notes?.trim()].filter((n): n is string => !!n);
  const joined = notes.length === 2 && notes[0] === notes[1] ? notes[0] : notes.join('\n');
  return {
    startedAt: Math.min(keep.startedAt, drop.startedAt),
    endedAt: ends.length ? Math.max(...ends) : null,
    payload: { ...keep.payload, ...(joined ? { notes: joined } : {}) },
  };
}
