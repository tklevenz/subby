import { LogPayloadSchema, type LogPayload } from '../schemas/log.schema';

/** Whether a payload is complete enough to save (schema-valid and not empty). */
export function isCompletePayload(p: LogPayload): boolean {
  if (!LogPayloadSchema.safeParse(p).success) return false;
  switch (p.type) {
    case 'growth':
      return p.weightG !== undefined || p.heightCm !== undefined || p.headCm !== undefined;
    case 'milestone':
      return Boolean(p.key || p.custom?.trim());
    case 'note':
      return p.text.trim().length > 0;
    case 'medication':
      return p.name.trim().length > 0;
    case 'temperature':
      return p.celsius > 25 && p.celsius < 45; // sanity range, catches unit mix-ups
    default:
      return true;
  }
}

/**
 * A new solids feed needs a food. Only for logging new ones: entries imported from Baby Buddy have no food list
 * and must stay editable.
 */
export const isEmptySolids = (p: LogPayload): boolean =>
  p.type === 'feed' && p.method === 'solids' && !(p.foods ?? []).some((f) => f.trim().length > 0);

/**
 * A timed entry's end may not come before its start. The same moment is fine (a bottle, or an entry edited down to
 * nothing): the log sheet and the edit screen share this rule.
 */
export const endBeforeStart = (startedAt: number, endedAt: number | null): boolean => endedAt !== null && endedAt < startedAt;
