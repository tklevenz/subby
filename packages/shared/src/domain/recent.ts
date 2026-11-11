import type { LogEntry, PayloadOf } from '../schemas/log.schema';

/** Distinct values ordered by most recent use (logs sorted startedAt DESC). */
function distinctRecent(values: Iterable<string>, limit: number): string[] {
  const seen = new Map<string, string>(); // lowercased → first-seen casing
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, v.trim());
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

export function recentFoods(logs: LogEntry[], limit = 12): string[] {
  return distinctRecent(
    logs.flatMap((l) => (l.payload.type === 'feed' ? l.payload.foods ?? [] : [])),
    limit,
  );
}

/** Last-used dose settings per medication name, most recent first. */
export function recentMedications(logs: LogEntry[], limit = 6): PayloadOf<'medication'>[] {
  const out = new Map<string, PayloadOf<'medication'>>();
  for (const l of logs) {
    if (l.isDeleted) continue;
    if (l.payload.type !== 'medication') continue;
    const key = l.payload.name.trim().toLowerCase();
    if (!out.has(key)) out.set(key, l.payload);
    if (out.size >= limit) break;
  }
  return [...out.values()];
}

/** Foods that were flagged as allergen or had a reaction noted. */
export function flaggedFoods(logs: LogEntry[]): string[] {
  return distinctRecent(
    logs.flatMap((l) =>
      l.payload.type === 'feed' && (l.payload.allergen || l.payload.reaction) ? l.payload.foods ?? [] : [],
    ),
    100,
  );
}

/** `last`: the latest dose, to log the next one like it. */
export type MedicationDue = { name: string; dueAt: number; lastAt: number; last: PayloadOf<'medication'> };

/** Next due time per medication with a dosing interval (latest dose of each name). */
export function medicationsDue(logs: LogEntry[]): MedicationDue[] {
  const seen = new Set<string>();
  const out: MedicationDue[] = [];
  for (const l of logs) {
    if (l.isDeleted) continue;
    if (l.payload.type !== 'medication') continue;
    const key = l.payload.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (l.payload.nextDoseIntervalMin) {
      out.push({ name: l.payload.name, lastAt: l.startedAt, dueAt: l.startedAt + l.payload.nextDoseIntervalMin * 60_000, last: l.payload });
    }
  }
  return out.sort((a, b) => a.dueAt - b.dueAt);
}

/**
 * When the next pumping session is due: the last completed session's start plus `intervalMin` (the pumping
 * reminder's interval, the same time its notification uses). Null without one, or while a session is running.
 */
export function pumpingDue(logs: LogEntry[], intervalMin: number): { dueAt: number; lastAt: number } | null {
  const pumps = logs.filter((l) => !l.isDeleted && l.payload.type === 'pumping');
  if (pumps.some((l) => l.endedAt === null)) return null;
  const lastAt = Math.max(...pumps.map((l) => l.startedAt));
  return pumps.length ? { lastAt, dueAt: lastAt + intervalMin * 60_000 } : null;
}
