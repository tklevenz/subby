import { describe, expect, it } from 'vitest';
import { cToF, fToC, formatTemperature, formatVolume, formatWeight, mlToOz, ozToMl } from '../domain/units';

describe('units', () => {
  it('round-trips conversions', () => {
    expect(ozToMl(mlToOz(120))).toBeCloseTo(120);
    expect(fToC(cToF(37))).toBeCloseTo(37);
  });

  it('formats per unit system', () => {
    expect(formatVolume(120, 'metric')).toBe('120 ml');
    expect(formatVolume(120, 'imperial')).toBe('4.1 oz');
    expect(formatWeight(3450, 'metric')).toBe('3.45 kg');
    expect(formatWeight(850, 'metric')).toBe('850 g');
    expect(formatWeight(999.6, 'metric')).toBe('1 kg');
    expect(formatWeight(906, 'imperial')).toBe('2 lb 0 oz');
    expect(formatWeight(3450, 'imperial')).toBe('7 lb 9.7 oz');
    expect(formatTemperature(37, 'imperial')).toBe('98.6 °F');
  });
});

describe('formatDose', () => {
  it('uses the singular for one drop or tablet', async () => {
    const { formatDose } = await import('../domain/units');
    expect(formatDose(1, 'drops')).toBe('1 drop');
    expect(formatDose(2, 'tablets')).toBe('2 tablets');
    expect(formatDose(2.5, 'ml')).toBe('2.5 ml');
    expect(formatDose(1)).toBe('1');
  });
});
