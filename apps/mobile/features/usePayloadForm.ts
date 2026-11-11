import { useState } from 'react';
import type { LogPayload } from '@subby/shared';

/**
 * A form's payload with the editors' `patch` (merge some fields) and whether it differs from where it started
 * (an unset field and a missing one compare equal, as JSON does). `initial` may be a function, run once.
 */
export function usePayloadForm<P extends LogPayload>(initial: P | (() => P)) {
  const [first] = useState(initial);
  const [payload, setPayload] = useState<P>(first);
  // The editors are shared by every type and hand over any payload's fields; this form only ever holds its own type.
  const patch = (p: Partial<LogPayload>) => setPayload((cur) => ({ ...cur, ...p }) as P);
  const changed = JSON.stringify(payload) !== JSON.stringify(first);
  return { payload, setPayload, patch, changed };
}
