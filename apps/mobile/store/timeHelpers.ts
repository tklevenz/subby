import { useEffect, useRef, useState } from 'react';

/** Milliseconds-based stopwatch that stays in sync with real elapsed time. */
export function useLiveDuration(startMs: number | null) {
  const [elapsed, setElapsed] = useState(0);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    if (startMs === null) {
      setElapsed(0);
      return;
    }

    const tick = () => {
      setElapsed(Date.now() - startMs);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frameRef.current);
  }, [startMs]);

  return elapsed;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatRelative(msAgo: number): string {
  const totalSec = Math.floor(msAgo / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);

  if (h > 0) return `${h}h ${m}m ago`;
  if (m > 0) return `${m}m ago`;
  return 'Just now';
}

export function formatTimeShort(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
