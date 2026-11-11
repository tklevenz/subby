import type { LogPayload } from '../schemas/log.schema';

/** The photo file a note points at on this phone, if any. Only notes carry one. */
export const notePhoto = (payload: LogPayload): string | undefined => (payload.type === 'note' ? payload.photoUri : undefined);
