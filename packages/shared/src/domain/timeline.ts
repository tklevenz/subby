import type { LogEntry } from '../schemas/log.schema';
import { addDays } from './stats';

export type TimelineItem =
  | { kind: 'entry'; entry: LogEntry }
  /** Awake between two sleeps (`ongoing`: since the last sleep, until now). */
  | { kind: 'awake'; from: number; to: number; ongoing: boolean };

/**
 * One day of History, newest first: the day's entries, plus a sleep that ran into it from the evening
 * before, with the wake windows between sleeps. A wake window sits right below the sleep that ended it
 * and heads the entries of that awake time; today's current one (no sleep running) comes first.
 */
export function dayTimeline(logs: LogEntry[], day: number, now: number): TimelineItem[] {
  const end = addDays(day, 1);
  const live = logs.filter((l) => !l.isDeleted);
  const sleeps = live.filter((l) => l.logType === 'sleep').sort((a, b) => a.startedAt - b.startedAt);
  const inDay = live.filter(
    (l) => (l.startedAt >= day && l.startedAt < end) || (l.logType === 'sleep' && l.startedAt < day && (l.endedAt ?? now) > day),
  );

  const keyed: { key: number; item: TimelineItem }[] = inDay.map((entry) => ({ key: entry.startedAt, item: { kind: 'entry', entry } }));
  for (let i = 0; i < sleeps.length; i++) {
    const done = sleeps[i]!;
    if (done.endedAt === null) continue;
    const next = sleeps[i + 1];
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
