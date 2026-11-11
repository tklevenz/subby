import { formatNumber, t } from '../i18n';
import { MEDICATION_UNITS, type MedicationUnit } from '../schemas/log.schema';

export type UnitSystem = 'metric' | 'imperial';

export const ML_PER_FL_OZ = 29.5735;
export const G_PER_LB = 453.592;
export const G_PER_OZ = 28.3495;
export const CM_PER_IN = 2.54;

export const mlToOz = (ml: number) => ml / ML_PER_FL_OZ;
export const ozToMl = (oz: number) => oz * ML_PER_FL_OZ;
export const gToLb = (g: number) => g / G_PER_LB;
export const lbToG = (lb: number) => lb * G_PER_LB;
export const cmToIn = (cm: number) => cm / CM_PER_IN;
export const inToCm = (inches: number) => inches * CM_PER_IN;
export const cToF = (c: number) => (c * 9) / 5 + 32;
export const fToC = (f: number) => ((f - 32) * 5) / 9;

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** The unit volumes are shown in. */
export const volumeUnit = (system: UnitSystem): string => (system === 'metric' ? 'ml' : 'oz');

/** A volume in ml, as a number in the display unit (not rounded). */
export const volumeIn = (ml: number, system: UnitSystem): number => (system === 'metric' ? ml : mlToOz(ml));

export type Measure = 'volume' | 'weight' | 'length' | 'temperature';

/**
 * How each quantity is entered in each system: canonical value (ml, g, cm, °C) to display number and back, the unit
 * label and the decimals shown. Heights and head size are both `length`.
 */
export const MEASURES: Record<Measure, Record<UnitSystem, { to: (canonical: number) => number; from: (shown: number) => number; suffix: string; decimals: number }>> = {
  volume: {
    metric: { to: (n) => n, from: (n) => n, suffix: 'ml', decimals: 0 },
    imperial: { to: mlToOz, from: ozToMl, suffix: 'oz', decimals: 1 },
  },
  weight: {
    metric: { to: (g) => g / 1000, from: (kg) => kg * 1000, suffix: 'kg', decimals: 3 },
    imperial: { to: gToLb, from: lbToG, suffix: 'lb', decimals: 2 },
  },
  length: {
    metric: { to: (n) => n, from: (n) => n, suffix: 'cm', decimals: 1 },
    imperial: { to: cmToIn, from: inToCm, suffix: 'in', decimals: 1 },
  },
  temperature: {
    metric: { to: (n) => n, from: (n) => n, suffix: '°C', decimals: 1 },
    imperial: { to: cToF, from: fToC, suffix: '°F', decimals: 1 },
  },
};

export function formatVolume(ml: number, system: UnitSystem): string {
  return system === 'metric' ? `${formatNumber(Math.round(ml))} ml` : `${formatNumber(round(mlToOz(ml), 1))} oz`;
}

export function formatWeight(g: number, system: UnitSystem): string {
  // Rounded before splitting, so 999.6 g is "1 kg" and 31.96 oz is "2 lb 0 oz", never "1000 g" or "1 lb 16 oz".
  if (system === 'metric') return Math.round(g) >= 1000 ? `${formatNumber(round(g / 1000, 2))} kg` : `${formatNumber(Math.round(g))} g`;
  const totalOz = round(g / G_PER_OZ, 1);
  const lb = Math.floor(totalOz / 16);
  const oz = round(totalOz - lb * 16, 1);
  return lb > 0 ? `${formatNumber(lb)} lb ${formatNumber(oz)} oz` : `${formatNumber(oz)} oz`;
}

export function formatLength(cm: number, system: UnitSystem): string {
  return system === 'metric' ? `${formatNumber(round(cm, 1))} cm` : `${formatNumber(round(cmToIn(cm), 1))} in`;
}

export function formatTemperature(c: number, system: UnitSystem): string {
  return system === 'metric' ? `${formatNumber(round(c, 1))} °C` : `${formatNumber(round(cToF(c), 1))} °F`;
}

/** A medication unit's name for `count` of it: "drop", "tablets", "ml". Unknown units (another phone's) as stored. */
export function medicationUnit(unit: string, count: number): string {
  return (MEDICATION_UNITS as readonly string[]).includes(unit) ? t(`unit.${unit as MedicationUnit}`, { count }) : unit;
}

/** A medication dose as text: "2.5 ml", "1 drop", "2 tablets". */
export function formatDose(dose: number, unit?: string): string {
  return unit ? `${formatNumber(dose)} ${medicationUnit(unit, dose)}` : formatNumber(dose);
}
