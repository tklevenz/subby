import { useEffect, useRef } from 'react';

/**
 * Calls `tick` every `ms` while `enabled`, waiting for one tick to finish before scheduling the next, so a slow
 * request can't overlap with the following one (two ticks both seeing "approved" would finish twice).
 * `tick` returns true to stop; a throw also stops and goes to `onError`. Stops for good on unmount or when
 * `enabled` or `key` change: a tick that finishes after that is ignored.
 */
export function usePoll(
  enabled: boolean,
  ms: number,
  tick: () => Promise<boolean | void>,
  onError: (e: unknown) => void,
  key?: unknown,
) {
  const latest = useRef({ tick, onError });
  latest.current = { tick, onError };

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const stop = await latest.current.tick();
        if (!alive) return;
        if (stop === true) return;
      } catch (e) {
        if (alive) latest.current.onError(e);
        return;
      }
      timer = setTimeout(run, ms);
    };
    timer = setTimeout(run, ms);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, ms, key]);
}
