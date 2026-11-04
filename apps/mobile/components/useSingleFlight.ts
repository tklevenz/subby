import { useCallback, useRef } from 'react';

/**
 * Wraps async handlers so a second tap while the first is still running does nothing (a quick double tap would
 * otherwise log twice, or start two timers). One guard per component: all handlers wrapped by it share it.
 */
export function useSingleFlight() {
  const busy = useRef(false);
  return useCallback(
    <A extends unknown[]>(fn: (...args: A) => Promise<unknown>) =>
      async (...args: A) => {
        if (busy.current) return;
        busy.current = true;
        try {
          await fn(...args);
        } finally {
          busy.current = false;
        }
      },
    [],
  );
}
