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
