import type { Child } from '../schemas/child.schema';
import type { LogEntry } from '../schemas/log.schema';
import { WHO_LMS, type LmsRow } from './who/lms';

export type GrowthMeasure = keyof typeof WHO_LMS; // weightKg | lengthCm | headCm
export type WhoSex = 'male' | 'female';

const DAYS_PER_MONTH = 30.4375;
export const WHO_MAX_MONTHS = 24;

const isoToMs = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

/** Age in fractional months at `at`, from the birth date (corrected age isn't supported). */
export function growthAgeMonths(child: Pick<Child, 'birthDate'>, at: number): number {
  const from = isoToMs(child.birthDate);
  // Calendar time: a DST change in between shouldn't shift the age by an hour.
  const dstShift = (new Date(from).getTimezoneOffset() - new Date(at).getTimezoneOffset()) * 60_000;
  return (at - from + dstShift) / 86_400_000 / DAYS_PER_MONTH;
}

/** LMS parameters at a fractional month, linearly interpolated; null outside 0–24 months. */
export function lmsAt(measure: GrowthMeasure, sex: WhoSex, months: number): LmsRow | null {
  const table = WHO_LMS[measure][sex];
  if (months < 0 || months > WHO_MAX_MONTHS) return null;
  const i = Math.min(Math.floor(months), WHO_MAX_MONTHS - 1);
  const t = months - i;
  const [a, b] = [table[i], table[i + 1]];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function zScore(value: number, [L, M, S]: LmsRow): number {
  return Math.abs(L) < 1e-9 ? Math.log(value / M) / S : ((value / M) ** L - 1) / (L * S);
}

export function valueAtZ(z: number, [L, M, S]: LmsRow): number {
  return Math.abs(L) < 1e-9 ? M * Math.exp(S * z) : M * (1 + L * S * z) ** (1 / L);
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Percentile (0–100) of a measurement, or null when out of the WHO range or sex unknown. */
export function growthPercentile(
  measure: GrowthMeasure,
  sex: Child['sex'],
  months: number,
  value: number,
): number | null {
  if (sex !== 'male' && sex !== 'female') return null;
  if (!(value > 0)) return null; // the LMS formula takes a log: no percentile for 0 or less
  const lms = lmsAt(measure, sex, months);
  return lms ? normalCdf(zScore(value, lms)) * 100 : null;
}

export function formatPercentile(p: number): string {
  if (p < 0.1) return '<0.1st';
  if (p > 99.9) return '>99.9th';
  const n = p < 1 || p > 99 ? Math.round(p * 10) / 10 : Math.round(p);
  const lastDigit = Math.floor(n) % 10;
  const teen = Math.floor(n) % 100 >= 11 && Math.floor(n) % 100 <= 13;
  const suffix = !Number.isInteger(n) || teen ? 'th' : ['th', 'st', 'nd', 'rd'][lastDigit] ?? 'th';
  return `${n}${suffix}`;
}

/** Percentiles drawn on growth charts, as in the WHO/CDC charts. */
export const CHART_PERCENTILES = [3, 15, 50, 85, 97] as const;
const Z_FOR: Record<(typeof CHART_PERCENTILES)[number], number> = {
  3: -1.880794, 15: -1.036433, 50: 0, 85: 1.036433, 97: 1.880794,
};

/** Percentile curves sampled every `step` months over 0–24. */
export function percentileCurves(measure: GrowthMeasure, sex: WhoSex, step = 0.5) {
  return CHART_PERCENTILES.map((p) => {
    const points: { months: number; value: number }[] = [];
    for (let m = 0; m <= WHO_MAX_MONTHS + 1e-9; m += step) {
      points.push({ months: m, value: valueAtZ(Z_FOR[p], lmsAt(measure, sex, m)!) });
    }
    return { percentile: p, points };
  });
}

export type GrowthPoint = { id: string; at: number; months: number; value: number };

/** Measurements of one kind in chart units (kg / cm), oldest first. */
export function growthPoints(logs: LogEntry[], child: Pick<Child, 'birthDate'>, measure: GrowthMeasure): GrowthPoint[] {
  const out: GrowthPoint[] = [];
  for (const l of logs) {
    if (l.isDeleted) continue;
    const p = l.payload;
    if (p.type !== 'growth') continue;
    const value = measure === 'weightKg' ? (p.weightG !== undefined ? p.weightG / 1000 : undefined)
      : measure === 'lengthCm' ? p.heightCm : p.headCm;
    if (value === undefined) continue;
    out.push({ id: l.id, at: l.startedAt, months: growthAgeMonths(child, l.startedAt), value });
  }
  return out.sort((a, b) => a.at - b.at);
}
