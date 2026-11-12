/** A phone's clock this far off the server's gets a warning: sync's "newest edit wins" goes by phone clocks. */
export const CLOCK_WARN_MS = 5 * 60 * 1000;
/** Answers slower than this say too little about the offset (it could be anywhere in the round trip). */
const MAX_ROUND_TRIP_MS = 30 * 1000;

/**
 * How far this phone's clock is off the server's (positive: ahead), from one request sent at `sentAt` and answered
 * at `receivedAt` (both phone time) with the server's `serverTime`. Null when the server didn't say or the round trip
 * was too slow to tell.
 */
export function clockOffset(sentAt: number, receivedAt: number, serverTime: number | undefined): number | null {
  if (serverTime === undefined || !Number.isFinite(serverTime)) return null;
  const roundTrip = receivedAt - sentAt;
  if (roundTrip < 0 || roundTrip > MAX_ROUND_TRIP_MS) return null;
  return sentAt + roundTrip / 2 - serverTime;
}

/** The offset worth warning about, else null. */
export const clockOff = (offset: number | null) => (offset !== null && Math.abs(offset) > CLOCK_WARN_MS ? offset : null);
