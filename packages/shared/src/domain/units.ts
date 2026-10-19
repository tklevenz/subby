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

export function formatVolume(ml: number, system: UnitSystem): string {
  return system === 'metric' ? `${Math.round(ml)} ml` : `${round(mlToOz(ml), 1)} oz`;
}

export function formatWeight(g: number, system: UnitSystem): string {
  if (system === 'metric') return g >= 1000 ? `${round(g / 1000, 2)} kg` : `${Math.round(g)} g`;
  const totalOz = g / G_PER_OZ;
  const lb = Math.floor(totalOz / 16);
  const oz = round(totalOz - lb * 16, 1);
  return lb > 0 ? `${lb} lb ${oz} oz` : `${oz} oz`;
}

export function formatLength(cm: number, system: UnitSystem): string {
  return system === 'metric' ? `${round(cm, 1)} cm` : `${round(cmToIn(cm), 1)} in`;
}

export function formatTemperature(c: number, system: UnitSystem): string {
  return system === 'metric' ? `${round(c, 1)} °C` : `${round(cToF(c), 1)} °F`;
}
