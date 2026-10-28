import type { Child } from '../schemas/child.schema';
import type { LogEntry, PayloadOf } from '../schemas/log.schema';
import { growthAgeMonths } from './growth';
import { isNap, addDays } from './stats';
import { startOfDay } from './time';

// SweetSpot-style nap prediction, entirely on device: typical wake windows for the
// baby's age, nudged towards the baby's own last 7 days.

const MIN = 60_000;
const H = 60 * MIN;

export type AgeNorms = {
  /** Typical awake time between sleeps, minutes. */
  wakeMin: number;
  wakeMax: number;
  naps: number;
  /** Typical nap length, minutes. */
  napLength: number;
};

/** Common pediatric sleep guidance; a starting point, not a rule. Upper bound in months (exclusive). */
const AGE_NORMS: [maxMonths: number, norms: AgeNorms][] = [
  [1, { wakeMin: 35, wakeMax: 60, naps: 5, napLength: 45 }],
  [3, { wakeMin: 60, wakeMax: 90, naps: 4, napLength: 60 }],
  [5, { wakeMin: 75, wakeMax: 120, naps: 4, napLength: 60 }],
  [7, { wakeMin: 120, wakeMax: 150, naps: 3, napLength: 75 }],
  [9, { wakeMin: 135, wakeMax: 180, naps: 2, napLength: 90 }],
  [12, { wakeMin: 150, wakeMax: 210, naps: 2, napLength: 90 }],
  [15, { wakeMin: 180, wakeMax: 240, naps: 2, napLength: 90 }],
  [18, { wakeMin: 240, wakeMax: 330, naps: 1, napLength: 120 }],
  [24, { wakeMin: 300, wakeMax: 360, naps: 1, napLength: 120 }],
  [Infinity, { wakeMin: 330, wakeMax: 390, naps: 1, napLength: 105 }],
];

export function ageNorms(months: number): AgeNorms {
  return AGE_NORMS.find(([max]) => months < max)![1];
}

type SleepEntry = LogEntry & { payload: PayloadOf<'sleep'> };
const isSleep = (l: LogEntry): l is SleepEntry => l.payload.type === 'sleep';

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Completed sleeps, oldest first. Night sleep logged in pieces (night wakings) is merged
 * into one night, so bedtime is its first start and the morning wake-up its last end.
 */
function completedSleeps(logs: LogEntry[]): SleepEntry[] {
  const sorted = logs
    .filter((l): l is SleepEntry => isSleep(l) && l.endedAt !== null)
    .sort((a, b) => a.startedAt - b.startedAt);
  const out: SleepEntry[] = [];
  for (const s of sorted) {
    const prev = out.at(-1);
    if (prev && !isNap(prev) && !isNap(s) && s.startedAt - prev.endedAt! < 3 * H) {
      out[out.length - 1] = { ...prev, endedAt: Math.max(prev.endedAt!, s.endedAt!) };
    } else out.push(s);
  }
  return out;
}

export type WakeWindow = {
  /** 0 = first window after night sleep, 1 = after the first nap, … */
  index: number;
  minutes: number;
  /** The sleep that ended this window was night sleep (i.e. this was the bedtime window). */
  beforeNight: boolean;
};

/** Wake windows between consecutive completed sleeps since `since`. Gaps over 10 h are treated as missing data. */
export function wakeWindows(logs: LogEntry[], since: number): WakeWindow[] {
  const sleeps = completedSleeps(logs);
  const out: WakeWindow[] = [];
  let index = 0;
  for (let i = 1; i < sleeps.length; i++) {
    const prev = sleeps[i - 1];
    const cur = sleeps[i];
    index = isNap(prev) ? index + 1 : 0;
    const gap = cur.startedAt - prev.endedAt!;
    if (cur.startedAt < since || gap <= 0 || gap > 10 * H) continue;
    out.push({ index, minutes: gap / MIN, beforeNight: !isNap(cur) });
  }
  return out;
}

/** Minutes after local midnight; evening bedtimes after midnight count as 24 h+. */
function clockMinutes(t: number, wrapBefore = 12 * 60): number {
  const m = (t - startOfDay(t)) / MIN;
  return m < wrapBefore ? m + 24 * 60 : m;
}

export type SleepHabits = {
  /** Median wake-window minutes per nap index (≥ 3 samples). */
  napWindows: Map<number, number>;
  bedtimeWindow: number | null;
  /** Median clock time (minutes after midnight, may exceed 24 h) of night-sleep starts. */
  bedtimeClock: number | null;
  /** Median clock time of the morning wake-up (end of night sleep). */
  wakeClock: number | null;
  /** Median nap length per nap index, minutes. */
  napLengths: Map<number, number>;
  /** Median length of any nap, minutes. */
  napLength: number | null;
  /** The most naps at least `NAP_DAY_SHARE` of the days had (0 when naps are rarely taken or logged). */
  napsPerDay: number | null;
};

const MIN_SAMPLES = 3;
/**
 * A nap counts as part of the day when at least this share of days had it. A median would drop it as soon as most
 * days skip it (a nap being phased out, or days it went unlogged), and predict bedtime in the morning; predicting a
 * nap costs little, since the prediction moves on to bedtime once the nap window has passed.
 */
const NAP_DAY_SHARE = 0.3;
/**
 * Half the predicted window when it comes from the baby's own history, minutes. Replaying two years of real
 * history put the actual start within ±30 min about half the time (±15 min: a third).
 */
const RANGE_MIN = 30;

/** The baby's own patterns over the 7 days before `now`. */
export function sleepHabits(logs: LogEntry[], now: number, days = 7): SleepHabits {
  const since = now - days * 24 * H;
  const windows = wakeWindows(logs, since);
  const group = (pred: (w: WakeWindow) => boolean) => windows.filter(pred).map((w) => w.minutes);

  const napWindows = new Map<number, number>();
  for (const i of new Set(windows.filter((w) => !w.beforeNight).map((w) => w.index))) {
    const xs = group((w) => !w.beforeNight && w.index === i);
    if (xs.length >= MIN_SAMPLES) napWindows.set(i, median(xs)!);
  }
  const bedXs = group((w) => w.beforeNight);

  const recent = completedSleeps(logs).filter((l) => l.startedAt >= since);
  const nights = recent.filter((l) => !isNap(l));
  const naps = recent.filter(isNap);

  // Nap lengths by index within the day (naps since the morning wake-up).
  const napLengths = new Map<number, number[]>();
  let idx = 0;
  let prevWasNight = true;
  for (const s of recent) {
    if (!isNap(s)) {
      prevWasNight = true;
      continue;
    }
    idx = prevWasNight ? 0 : idx + 1;
    prevWasNight = false;
    napLengths.set(idx, [...(napLengths.get(idx) ?? []), (s.endedAt! - s.startedAt) / MIN]);
  }

  return {
    napWindows,
    bedtimeWindow: bedXs.length >= MIN_SAMPLES ? median(bedXs) : null,
    bedtimeClock: nights.length >= MIN_SAMPLES ? median(nights.map((n) => clockMinutes(n.startedAt))) : null,
    wakeClock: nights.length >= MIN_SAMPLES ? median(nights.map((n) => clockMinutes(n.endedAt!, 0))) : null,
    napLengths: new Map(
      [...napLengths].filter(([, xs]) => xs.length >= MIN_SAMPLES).map(([i, xs]) => [i, median(xs)!]),
    ),
    napLength: naps.length >= MIN_SAMPLES ? median(naps.map((n) => (n.endedAt! - n.startedAt) / MIN)) : null,
    // Over complete days with a logged morning wake-up (so zero-nap days count too).
    napsPerDay: (() => {
      const days = [...new Set(nights.map((n) => startOfDay(n.endedAt!)))].filter((d) => d < startOfDay(now));
      if (days.length < MIN_SAMPLES) return null;
      const counts = days.map((d) => naps.filter((n) => startOfDay(n.startedAt) === d).length);
      for (let k = Math.max(...counts); k > 0; k--) if (counts.filter((c) => c >= k).length >= NAP_DAY_SHARE * days.length) return k;
      return 0;
    })(),
  };
}

export type SleepPrediction = {
  kind: 'nap' | 'bedtime';
  earliest: number;
  latest: number;
  /** 'personal' when the baby's own history shaped it, else age-based. */
  basis: 'age' | 'personal';
  wakeAt: number;
  /** Nap number today (0-based) when kind is 'nap'. */
  napIndex: number;
  /** Expected nap length in minutes (this nap index, else any nap, else the age norm); null for bedtime. */
  napMinutes: number | null;
};

/** Personal median pulled 30 % towards the age norm, kept within a sane band around it. */
function blend(personal: number | null | undefined, norms: AgeNorms): { center: number; personal: boolean } {
  const ageMid = (norms.wakeMin + norms.wakeMax) / 2;
  if (personal == null) return { center: ageMid, personal: false };
  const c = personal * 0.7 + ageMid * 0.3;
  return { center: Math.min(Math.max(c, norms.wakeMin * 0.75), norms.wakeMax * 1.25), personal: true };
}

/** Clock time (minutes after midnight, may exceed 24 h) on the day of `ref`. */
const atClock = (ref: number, minutes: number) => addDays(startOfDay(ref), Math.floor(minutes / 1440)) + (minutes % 1440) * MIN;

/**
 * When the baby will likely be ready for the next sleep, or null while asleep / without a
 * recent wake-up. `logs` needs at least the last 7 days of sleep.
 */
export function predictNextSleep(
  logs: LogEntry[],
  child: Pick<Child, 'birthDate'>,
  now: number,
): SleepPrediction | null {
  const sleeps = logs.filter(isSleep);
  if (sleeps.some((s) => s.endedAt === null)) return null;
  const last = completedSleeps(sleeps).at(-1);
  if (!last || now - last.endedAt! > 12 * H) return null;

  const norms = ageNorms(growthAgeMonths(child, now));
  const habits = sleepHabits(sleeps, now);
  const wakeAt = last.endedAt!;

  // Woke from night sleep well before the usual morning: a night waking, not the day's start.
  const wakeClock = (wakeAt - startOfDay(wakeAt)) / MIN;
  if (!isNap(last) && wakeClock < (habits.wakeClock ?? 6 * 60) - 90) return null;

  // Which nap comes next today: count naps since the last night sleep.
  const sorted = completedSleeps(sleeps);
  let napIndex = 0;
  for (let i = sorted.length - 1; i >= 0 && isNap(sorted[i]); i--) napIndex++;

  const napsPerDay = habits.napsPerDay ?? norms.naps;
  const nap = blend(habits.napWindows.get(napIndex), norms);
  const napStart = wakeAt + nap.center * MIN;
  const bedtimeClock = habits.bedtimeClock !== null ? atClock(wakeAt, habits.bedtimeClock) : null;

  const half = nap.personal ? RANGE_MIN : (norms.wakeMax - norms.wakeMin) / 2;

  // Bedtime once the day's naps are done, when a nap would run into the usual bedtime, or
  // when the nap window has already passed (skipped, or not logged).
  const isBedtime =
    napIndex >= napsPerDay ||
    (bedtimeClock !== null && napStart > bedtimeClock - 90 * MIN) ||
    napStart + (half + 30) * MIN < now;

  if (isBedtime) {
    const bed = blend(habits.bedtimeWindow, norms);
    const byWindow = wakeAt + bed.center * MIN;
    // Prefer the usual bedtime (naps may simply not be logged), unless it leaves too short a window.
    const center = bedtimeClock !== null && bedtimeClock - wakeAt >= norms.wakeMin * 0.75 * MIN ? bedtimeClock : byWindow;
    return {
      kind: 'bedtime',
      earliest: center - RANGE_MIN * MIN,
      latest: center + RANGE_MIN * MIN,
      basis: bed.personal || bedtimeClock !== null ? 'personal' : 'age',
      wakeAt,
      napIndex,
      napMinutes: null,
    };
  }

  return {
    kind: 'nap',
    earliest: napStart - half * MIN,
    latest: napStart + half * MIN,
    basis: nap.personal ? 'personal' : 'age',
    wakeAt,
    napIndex,
    napMinutes: habits.napLengths.get(napIndex) ?? habits.napLength ?? norms.napLength,
  };
}

export type ScheduleItem =
  | { kind: 'wake'; at: number; logged?: true }
  /** `running`: a nap still going; `end` is when it would usually end (or now). */
  | { kind: 'nap'; start: number; end: number; index: number; logged?: true; running?: true }
  | { kind: 'bedtime'; at: number; logged?: true };

/**
 * A suggested day: morning wake-up, naps and bedtime. Uses what today already logged (the wake-up, naps so far,
 * bedtime once it started) and predicts the rest from there; without a logged wake-up, the usual one (or 07:00).
 */
export function suggestedSchedule(
  logs: LogEntry[],
  child: Pick<Child, 'birthDate'>,
  now: number,
): { items: ScheduleItem[]; basis: 'age' | 'personal'; norms: AgeNorms } {
  const norms = ageNorms(growthAgeMonths(child, now));
  const habits = sleepHabits(logs, now);
  const today = startOfDay(now);

  // Today's logged wake-up, unless it was a night waking (well before the usual morning).
  const usualWake = habits.wakeClock ?? 7 * 60;
  const nightEnd = completedSleeps(logs)
    .filter((l) => !isNap(l) && l.endedAt! >= today && l.endedAt! < today + 14 * H)
    .at(-1)?.endedAt;
  const wakeLogged = nightEnd != null && (nightEnd - today) / MIN >= usualWake - 90;
  const wake = wakeLogged ? nightEnd : atClock(today, usualWake);
  const napLength = (i: number) => (habits.napLengths.get(i) ?? norms.napLength) * MIN;
  const usualBedtime = habits.bedtimeClock !== null ? atClock(today, habits.bedtimeClock) : null;

  const items: ScheduleItem[] = [{ kind: 'wake', at: wake, ...(wakeLogged ? { logged: true as const } : {}) }];
  let t = wake;
  let index = 0;
  // What today logged since the wake-up: naps, and bedtime once the night started.
  const logged = logs.filter((l): l is SleepEntry => isSleep(l) && l.startedAt >= wake && l.startedAt <= now).sort((a, b) => a.startedAt - b.startedAt);
  for (const s of logged) {
    if (!isNap(s)) {
      items.push({ kind: 'bedtime', at: s.startedAt, logged: true });
      return { items, basis: basis(habits), norms };
    }
    const running = s.endedAt === null;
    const end = running ? Math.max(now, s.startedAt + napLength(index)) : s.endedAt!;
    items.push({ kind: 'nap', start: s.startedAt, end, index, logged: true, ...(running ? { running: true as const } : {}) });
    t = end;
    index++;
  }

  // The rest of the day, from the last wake-up. A nap that would run into the usual bedtime is left out.
  const napsPerDay = habits.napsPerDay ?? norms.naps;
  for (; index < napsPerDay; index++) {
    const start = t + blend(habits.napWindows.get(index), norms).center * MIN;
    if (usualBedtime !== null && start > usualBedtime - 90 * MIN) break;
    const end = start + napLength(index);
    items.push({ kind: 'nap', start, end, index });
    t = end;
  }
  const byWindow = t + blend(habits.bedtimeWindow, norms).center * MIN;
  items.push({ kind: 'bedtime', at: usualBedtime !== null && usualBedtime - t >= norms.wakeMin * 0.75 * MIN ? usualBedtime : byWindow });
  return { items, basis: basis(habits), norms };
}

const basis = (habits: SleepHabits): 'age' | 'personal' =>
  habits.napWindows.size > 0 || habits.bedtimeClock !== null || habits.napsPerDay !== null ? 'personal' : 'age';
