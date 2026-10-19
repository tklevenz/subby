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

export function recentTags(logs: LogEntry[], limit = 12): string[] {
  return distinctRecent(logs.flatMap((l) => l.payload.tags ?? []), limit);
}

/** Last-used dose settings per medication name, most recent first. */
export function recentMedications(logs: LogEntry[], limit = 6): PayloadOf<'medication'>[] {
  const out = new Map<string, PayloadOf<'medication'>>();
  for (const l of logs) {
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

export type MedicationDue = { name: string; dueAt: number; lastAt: number };

/** Next due time per medication with a dosing interval (latest dose of each name). */
export function medicationsDue(logs: LogEntry[]): MedicationDue[] {
  const seen = new Set<string>();
  const out: MedicationDue[] = [];
  for (const l of logs) {
    if (l.payload.type !== 'medication') continue;
    const key = l.payload.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (l.payload.nextDoseIntervalMin) {
      out.push({ name: l.payload.name, lastAt: l.startedAt, dueAt: l.startedAt + l.payload.nextDoseIntervalMin * 60_000 });
    }
  }
  return out.sort((a, b) => a.dueAt - b.dueAt);
}
