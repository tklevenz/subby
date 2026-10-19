import type { LogPayload } from '../schemas/log.schema';
import { DIAPER_COLORS } from '../schemas/log.schema';
import { G_PER_LB, G_PER_OZ, fToC, inToCm, ozToMl } from './units';

/*
 * Baby Buddy (https://docs.baby-buddy.net/api/) → Kindred Log mapping. Pure: no I/O.
 * Baby Buddy doesn't store units, so quantities are converted using ImportUnits
 * (detected from the data with detectUnits(), confirmable by the user).
 */

// ---- Baby Buddy record shapes (fields we use) ----

type BBBase = { id: number; child: number | null; notes?: string | null; tags?: string[] };
export type BBChild = {
  id: number; first_name: string; last_name: string; birth_date: string;
  birth_time?: string | null; due_date?: string | null; slug: string; picture?: string | null;
};
export type BBFeeding = BBBase & {
  start: string; end: string; duration?: string | null;
  type: 'breast milk' | 'formula' | 'fortified breast milk' | 'solid food';
  method: 'bottle' | 'left breast' | 'right breast' | 'both breasts' | 'parent fed' | 'self fed';
  amount: number | null;
};
export type BBChange = BBBase & { time: string; wet: boolean; solid: boolean; color: string; amount: number | null };
export type BBSleep = BBBase & { start: string; end: string; nap?: boolean | null };
export type BBTummyTime = BBBase & { start: string; end: string; milestone?: string };
export type BBPumping = BBBase & { start: string; end: string; amount: number };
export type BBTemperature = BBBase & { time: string; temperature: number };
export type BBWeight = BBBase & { date: string; weight: number };
export type BBHeight = BBBase & { date: string; height: number };
export type BBHeadCircumference = BBBase & { date: string; head_circumference: number };
export type BBMedication = BBBase & {
  time: string; name: string; dosage: number | null; dosage_unit: string; next_dose_interval?: string | null;
};
export type BBNote = BBBase & { time: string; note: string };

export type BBRecords = {
  feedings: BBFeeding;
  changes: BBChange;
  sleep: BBSleep;
  'tummy-times': BBTummyTime;
  pumping: BBPumping;
  temperature: BBTemperature;
  weight: BBWeight;
  height: BBHeight;
  'head-circumference': BBHeadCircumference;
  medication: BBMedication;
  notes: BBNote;
};
export type BBEndpoint = keyof BBRecords;

/** Endpoints imported, in order. bmi (derived), timers (transient) and tags (inline) are skipped. */
export const BB_ENDPOINTS: readonly BBEndpoint[] = [
  'feedings', 'changes', 'sleep', 'tummy-times', 'pumping', 'temperature',
  'weight', 'height', 'head-circumference', 'medication', 'notes',
];

// ---- Units ----

export type ImportUnits = {
  volume: 'ml' | 'oz';
  weight: 'g' | 'kg' | 'lb' | 'oz';
  length: 'cm' | 'in';
  temperature: 'c' | 'f';
};

const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * Guess units from value magnitudes (infant/toddler ranges barely overlap between systems).
 * `fallback` (the user's unit setting) decides when there is no data.
 */
export function detectUnits(
  samples: { volume: number[]; weight: number[]; length: number[]; head: number[]; temperature: number[] },
  fallback: 'metric' | 'imperial',
): ImportUnits {
  const metric = fallback === 'metric';
  const vol = median(samples.volume);
  const w = median(samples.weight);
  const head = median(samples.head);
  const len = median(samples.length);
  const t = median(samples.temperature);
  return {
    // Bottle/pump amounts: ml typically 20–250, oz 0.5–9.
    volume: vol === undefined ? (metric ? 'ml' : 'oz') : vol > 12 ? 'ml' : 'oz',
    // Weights 2–25 kg ≈ 4.5–55 lb ≈ 70–880 oz ≈ 2000–25000 g.
    weight: w === undefined ? (metric ? 'kg' : 'lb') : w > 1000 ? 'g' : w > 60 ? 'oz' : metric ? 'kg' : 'lb',
    // Head 32–52 cm ≈ 12.5–20.5 in; length 45–110 cm ≈ 18–43 in.
    length: head !== undefined ? (head > 25 ? 'cm' : 'in') : len !== undefined ? (len > 44 ? 'cm' : 'in') : metric ? 'cm' : 'in',
    temperature: t === undefined ? (metric ? 'c' : 'f') : t > 50 ? 'f' : 'c',
  };
}

const toMl = (v: number, u: ImportUnits) => (u.volume === 'ml' ? v : ozToMl(v));
const toG = (v: number, u: ImportUnits) =>
  u.weight === 'g' ? v : u.weight === 'kg' ? v * 1000 : u.weight === 'lb' ? v * G_PER_LB : v * G_PER_OZ;
const toCm = (v: number, u: ImportUnits) => (u.length === 'cm' ? v : inToCm(v));
const toC = (v: number, u: ImportUnits) => (u.temperature === 'c' ? v : fToC(v));
const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

// ---- Time ----

/** ISO date-time with offset or Z → epoch ms. */
export function bbTime(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`Invalid date-time "${iso}"`);
  return ms;
}

/** Date-only (YYYY-MM-DD) measurements are placed at 12:00 local time. */
export function bbDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date "${date}"`);
  return new Date(y, m - 1, d, 12).getTime();
}

/** "HH:MM:SS" or "D HH:MM:SS" (Django duration) → minutes. */
export function bbDurationMinutes(s: string | null | undefined): number | undefined {
  if (!s) return undefined;
  const m = /^(?:(\d+) )?(\d+):(\d+):(\d+)/.exec(s);
  if (!m) return undefined;
  const [, d = '0', h, min, sec] = m;
  const total = Number(d) * 1440 + Number(h) * 60 + Number(min) + Number(sec) / 60;
  return total > 0 ? Math.round(total) : undefined;
}

// ---- Mapping ----

export type MappedEntry = {
  importRef: string;
  bbChildId: number | null;
  startedAt: number;
  endedAt: number | null;
  payload: LogPayload;
};

const common = (r: BBBase) => ({
  notes: r.notes?.trim() || undefined,
  tags: r.tags?.length ? r.tags : undefined,
});

/** Stable reference so re-imports from the same server skip existing rows. */
export const bbRef = (host: string, endpoint: string, id: number) => `babybuddy:${host}:${endpoint}:${id}`;

function span(r: { start: string; end: string }) {
  const startedAt = bbTime(r.start);
  // Completed timed entries always carry an end (see endedAt rule in log.schema).
  const endedAt = r.end ? Math.max(startedAt, bbTime(r.end)) : startedAt;
  return { startedAt, endedAt };
}

function mapFeeding(r: BBFeeding, u: ImportUnits): Omit<MappedEntry, 'importRef' | 'bbChildId'> {
  const { startedAt, endedAt } = span(r);
  const secs = Math.round((endedAt - startedAt) / 1000);
  const amountMl = r.amount !== null && r.amount !== undefined ? round(toMl(r.amount, u), 0) : undefined;
  const base = common(r);

  // Solid food wins over any method (BB data sometimes pairs it with a breast side).
  if (r.type === 'solid food') {
    const feeder = r.method === 'self fed' ? 'self' : r.method === 'parent fed' ? 'parent' : undefined;
    return { startedAt, endedAt, payload: { type: 'feed', method: 'solids', feeder, ...base } };
  }

  const milkType = r.type === 'formula' ? 'formula' : r.type === 'fortified breast milk' ? 'fortified' : 'breast_milk';
  switch (r.method) {
    case 'left breast':
      return { startedAt, endedAt, payload: { type: 'feed', method: 'breast', leftSeconds: secs || undefined, lastSide: 'left', ...base } };
    case 'right breast':
      return { startedAt, endedAt, payload: { type: 'feed', method: 'breast', rightSeconds: secs || undefined, lastSide: 'right', ...base } };
    case 'both breasts': {
      // BB stores only the total; split evenly (the original notes are kept).
      const half = Math.round(secs / 2);
      return {
        startedAt, endedAt,
        payload: { type: 'feed', method: 'breast', leftSeconds: half || undefined, rightSeconds: secs - half || undefined, ...base },
      };
    }
    default:
      // bottle, or breast milk/formula "parent/self fed" (cup, spoon) → bottle-style feed.
      return { startedAt, endedAt, payload: { type: 'feed', method: 'bottle', milkType, amountMl, ...base } };
  }
}

function mapChange(r: BBChange): Omit<MappedEntry, 'importRef' | 'bbChildId'> {
  const condition = r.wet && r.solid ? 'both' : r.wet ? 'wet' : r.solid ? 'dirty' : 'dry';
  const color = (DIAPER_COLORS as readonly string[]).includes(r.color) ? (r.color as (typeof DIAPER_COLORS)[number]) : undefined;
  return {
    startedAt: bbTime(r.time),
    endedAt: null,
    payload: { type: 'diaper', condition, color, amount: r.amount ?? undefined, ...common(r) },
  };
}

export function mapRecord<E extends BBEndpoint>(
  endpoint: E,
  record: BBRecords[E],
  host: string,
  units: ImportUnits,
): MappedEntry {
  const r = record as BBRecords[BBEndpoint];
  const meta = { importRef: bbRef(host, endpoint, r.id), bbChildId: r.child };
  const mapped = ((): Omit<MappedEntry, 'importRef' | 'bbChildId'> => {
    switch (endpoint) {
      case 'feedings':
        return mapFeeding(r as BBFeeding, units);
      case 'changes':
        return mapChange(r as BBChange);
      case 'sleep': {
        const s = r as BBSleep;
        return { ...span(s), payload: { type: 'sleep', nap: s.nap ?? undefined, ...common(s) } };
      }
      case 'tummy-times': {
        const t = r as BBTummyTime;
        return { ...span(t), payload: { type: 'activity', kind: 'tummy_time', milestone: t.milestone || undefined, ...common(t) } };
      }
      case 'pumping': {
        const p = r as BBPumping;
        return { ...span(p), payload: { type: 'pumping', amountMl: round(toMl(p.amount, units), 0), ...common(p) } };
      }
      case 'temperature': {
        const t = r as BBTemperature;
        return { startedAt: bbTime(t.time), endedAt: null, payload: { type: 'temperature', celsius: round(toC(t.temperature, units)), ...common(t) } };
      }
      case 'weight': {
        const w = r as BBWeight;
        return { startedAt: bbDate(w.date), endedAt: null, payload: { type: 'growth', weightG: round(toG(w.weight, units), 0), ...common(w) } };
      }
      case 'height': {
        const h = r as BBHeight;
        return { startedAt: bbDate(h.date), endedAt: null, payload: { type: 'growth', heightCm: round(toCm(h.height, units)), ...common(h) } };
      }
      case 'head-circumference': {
        const h = r as BBHeadCircumference;
        return { startedAt: bbDate(h.date), endedAt: null, payload: { type: 'growth', headCm: round(toCm(h.head_circumference, units)), ...common(h) } };
      }
      case 'medication': {
        const m = r as BBMedication;
        const unit = (['mg', 'ml', 'tablets', 'drops'] as const).find((x) => x === m.dosage_unit);
        return {
          startedAt: bbTime(m.time),
          endedAt: null,
          payload: {
            type: 'medication', name: m.name, dose: m.dosage ?? undefined, unit,
            nextDoseIntervalMin: bbDurationMinutes(m.next_dose_interval), ...common(m),
          },
        };
      }
      case 'notes': {
        const n = r as BBNote;
        return { startedAt: bbTime(n.time), endedAt: null, payload: { type: 'note', text: n.note, tags: common(n).tags } };
      }
    }
    throw new Error(`Unsupported endpoint ${endpoint}`);
  })();
  return { ...meta, ...mapped };
}
