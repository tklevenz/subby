import { useRef, useState } from 'react';
import { errorMessage } from './errorMessage';

/**
 * Runs an async action with a busy flag and its error: `busy` is true while it runs, a second `run` meanwhile is
 * ignored, and a failure becomes `error` (cleared by the next run), or goes to `onError` instead (an alert).
 * Resolves to whether the action succeeded.
 */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const run = async (action: () => Promise<unknown>, onError?: (e: unknown) => void): Promise<boolean> => {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      if (onError) onError(e);
      else setError(errorMessage(e));
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return { run, busy, error, setError };
}
