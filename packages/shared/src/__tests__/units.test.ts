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
    expect(formatWeight(3450, 'imperial')).toBe('7 lb 9.7 oz');
    expect(formatTemperature(37, 'imperial')).toBe('98.6 °F');
  });
});
