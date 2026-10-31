import type { LogEntry } from '../schemas/log.schema';
import { groupNights, type Night } from './nights';
import { addDays } from './stats';

export type TimelineItem =
  | { kind: 'entry'; entry: LogEntry }
  /** A night with wakings: its pieces as one block, at its start. */
  | { kind: 'night'; night: Night }
  /** Awake between two sleeps (`ongoing`: since the last sleep, until now). */
  | { kind: 'awake'; from: number; to: number; ongoing: boolean };

/**
 * One day of History, newest first: the day's entries, plus a sleep that ran into it from the evening
 * before, with the wake windows between sleeps. A wake window sits right below the sleep that ended it
 * and heads the entries of that awake time; today's current one (no sleep running) comes first. A night
 * with wakings is one item instead of its pieces and the wake windows between them.
 */
export function dayTimeline(logs: LogEntry[], day: number, now: number): TimelineItem[] {
  const end = addDays(day, 1);
  const live = logs.filter((l) => !l.isDeleted);
  const sleeps = live.filter((l) => l.logType === 'sleep').sort((a, b) => a.startedAt - b.startedAt);
  const inDay = live.filter(
    (l) => (l.startedAt >= day && l.startedAt < end) || (l.logType === 'sleep' && l.startedAt < day && (l.endedAt ?? now) > day),
  );

  const nightOf = new Map<string, Night>();
  for (const night of groupNights(live, now)) if (night.pieces.length > 1) for (const p of night.pieces) nightOf.set(p.id, night);

  const keyed: { key: number; item: TimelineItem }[] = [];
  const shown = new Set<Night>();
  for (const entry of inDay) {
    const night = nightOf.get(entry.id);
    if (!night) keyed.push({ key: entry.startedAt, item: { kind: 'entry', entry } });
    else if (!shown.has(night)) {
      shown.add(night);
      keyed.push({ key: night.start, item: { kind: 'night', night } });
    }
  }
  for (let i = 0; i < sleeps.length; i++) {
    const done = sleeps[i]!;
    if (done.endedAt === null) continue;
    const next = sleeps[i + 1];
    if (next && nightOf.has(done.id) && nightOf.get(done.id) === nightOf.get(next.id)) continue;
    if (next) {
      // Ends at the next sleep's start: sorts just below it.
      // Under a minute isn't a wake window (a sleep stopped and restarted by mistake).
      if (next.startedAt - done.endedAt >= 60_000 && next.startedAt >= day && next.startedAt < end) {
        keyed.push({ key: next.startedAt - 0.5, item: { kind: 'awake', from: done.endedAt, to: next.startedAt, ongoing: false } });
      }
    } else if (now >= day && now < end && done.endedAt < now) {
      keyed.push({ key: now, item: { kind: 'awake', from: done.endedAt, to: now, ongoing: true } });
    }
  }
  return keyed.sort((a, b) => b.key - a.key).map((k) => k.item);
}
