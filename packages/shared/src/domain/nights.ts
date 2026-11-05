import type { LogEntry, PayloadOf } from '../schemas/log.schema';
import { addDays, isNap } from './stats';

export type SleepEntry = LogEntry & { payload: PayloadOf<'sleep'> };
/** A live sleep (a deleted one keeps only `{type}`, so it would otherwise still look like a sleep). */
export const isSleepEntry = (l: LogEntry): l is SleepEntry => !l.isDeleted && l.payload.type === 'sleep';

/**
 * Night sleeps (not naps) less than this apart are one night, and the gap between them a night waking. A night is
 * stored as its pieces: splitting it for a waking is ordinary edits, and Baby Buddy's split nights fit as they are.
 */
export const NIGHT_GAP_MS = 3 * 3_600_000;

export type Waking = { start: number; end: number };

export type Night = {
  /** Its sleeps, oldest first; only the last can still be running. */
  pieces: SleepEntry[];
  start: number;
  /** null while the last piece is running. */
  end: number | null;
  wakings: Waking[];
  /** Asleep in total (a running piece until `now`). */
  asleepMs: number;
  /** The longest piece. */
  longestMs: number;
};

/** The night sleeps in `logs`, grouped into nights, oldest first. */
export function groupNights(logs: LogEntry[], now: number): Night[] {
  const sleeps = logs.filter((l): l is SleepEntry => isSleepEntry(l) && !l.isDeleted && !isNap(l)).sort((a, b) => a.startedAt - b.startedAt);
  const groups: SleepEntry[][] = [];
  for (const s of sleeps) {
    const last = groups.at(-1)?.at(-1);
    if (last && last.endedAt !== null && s.startedAt >= last.endedAt && s.startedAt - last.endedAt < NIGHT_GAP_MS) groups.at(-1)!.push(s);
    else groups.push([s]);
  }
  return groups.map((pieces) => {
    const lengths = pieces.map((p) => (p.endedAt ?? now) - p.startedAt);
    return {
      pieces,
      start: pieces[0]!.startedAt,
      end: pieces.at(-1)!.endedAt,
      wakings: pieces.slice(1).map((p, i) => ({ start: pieces[i]!.endedAt!, end: p.startedAt })),
      asleepMs: lengths.reduce((a, b) => a + b, 0),
      longestMs: Math.max(...lengths),
    };
  });
}

/** The night `id` belongs to, or undefined. */
export const nightOf = (nights: Night[], id: string) => nights.find((n) => n.pieces.some((p) => p.id === id));

/**
 * The night sleep pieces a night becomes after an edit: from `bedtime` to `wakeUp`, minus the wakings (sorted).
 * Null when it doesn't fit: a waking outside the night, ending before it starts, or overlapping another.
 */
export function nightPieces(bedtime: number, wakeUp: number, wakings: Waking[]): { start: number; end: number }[] | null {
  const sorted = [...wakings].sort((a, b) => a.start - b.start);
  const pieces: { start: number; end: number }[] = [];
  let from = bedtime;
  for (const w of sorted) {
    if (w.start <= from || w.end <= w.start || w.end >= wakeUp) return null;
    pieces.push({ start: from, end: w.start });
    from = w.end;
  }
  if (wakeUp <= from) return null;
  pieces.push({ start: from, end: wakeUp });
  return pieces;
}

export type NightStats = { asleepMs: number; awakeMs: number; wakings: number; longestMs: number };

const statsOf = (n: Night): NightStats => ({
  asleepMs: n.asleepMs,
  awakeMs: n.wakings.reduce((a, w) => a + w.end - w.start, 0),
  wakings: n.wakings.length,
  longestMs: n.longestMs,
});

/** Per day: the finished night that ended that morning (the longest, if a day has two), or null. */
export function nightsByDay(nights: Night[], days: number[]): (NightStats | null)[] {
  return days.map((day) => {
    const ended = nights.filter((n) => n.end !== null && n.end >= day && n.end < addDays(day, 1));
    const night = ended.sort((a, b) => b.asleepMs - a.asleepMs)[0];
    return night ? statsOf(night) : null;
  });
}

/** Averages over the nights there are; null without any. */
export function averageNights(nights: (NightStats | null)[]): (NightStats & { nights: number }) | null {
  const xs = nights.filter((n): n is NightStats => n !== null);
  if (!xs.length) return null;
  const avg = (k: keyof NightStats) => xs.reduce((a, n) => a + n[k], 0) / xs.length;
  return { asleepMs: avg('asleepMs'), awakeMs: avg('awakeMs'), wakings: avg('wakings'), longestMs: avg('longestMs'), nights: xs.length };
}
