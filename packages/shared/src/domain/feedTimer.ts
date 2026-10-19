import type { PayloadOf } from '../schemas/log.schema';

type Feed = PayloadOf<'feed'>;
export type Side = 'left' | 'right';

/*
 * A breastfeeding timer accumulates completed seconds per side in leftSeconds/rightSeconds;
 * the side currently running is timerSide, started at timerSideSince (epoch ms).
 * timerSide undefined = paused.
 */

/** Per-side seconds including the currently running segment. */
export function sideSeconds(p: Feed, now: number): { left: number; right: number } {
  const running = p.timerSide && p.timerSideSince !== undefined
    ? Math.max(0, Math.round((now - p.timerSideSince) / 1000))
    : 0;
  return {
    left: (p.leftSeconds ?? 0) + (p.timerSide === 'left' ? running : 0),
    right: (p.rightSeconds ?? 0) + (p.timerSide === 'right' ? running : 0),
  };
}

/** Fold the running segment into the side totals and clear the running state (= pause). */
export function pauseFeed(p: Feed, now: number): Feed {
  const { left, right } = sideSeconds(p, now);
  return {
    ...p,
    // Explicit undefined (not omitted) so a merge-patch clears them too.
    timerSide: undefined,
    timerSideSince: undefined,
    leftSeconds: left || undefined,
    rightSeconds: right || undefined,
    lastSide: p.timerSide ?? p.lastSide,
  };
}

/** Start or switch to a side. Tapping the side that is already running pauses. */
export function toggleSide(p: Feed, side: Side, now: number): Feed {
  const paused = pauseFeed(p, now);
  if (p.timerSide === side) return paused;
  return { ...paused, timerSide: side, timerSideSince: now, lastSide: side };
}
