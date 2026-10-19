import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LogPayloadSchema } from '../schemas/log.schema';
import { isCompletePayload } from '../domain/validate';
import {
  BB_ENDPOINTS, bbDurationMinutes, detectUnits, mapRecord,
  type BBEndpoint, type ImportUnits,
} from '../domain/babybuddy';

const METRIC: ImportUnits = { volume: 'ml', weight: 'g', length: 'cm', temperature: 'c' };
const H = 'bb.example';
const base = { id: 7, child: 1, notes: 'n', tags: [] as string[] };
const feeding = (type: string, method: string, amount: number | null = null) =>
  mapRecord('feedings', { ...base, start: '2026-04-11T08:28:00+02:00', end: '2026-04-11T08:38:00+02:00', type, method, amount } as never, H, METRIC);

describe('Baby Buddy mapping', () => {
  it('maps breast sides, splitting "both" evenly', () => {
    expect(feeding('breast milk', 'left breast').payload).toMatchObject({ method: 'breast', leftSeconds: 600, lastSide: 'left' });
    expect(feeding('breast milk', 'right breast').payload).toMatchObject({ method: 'breast', rightSeconds: 600 });
    expect(feeding('breast milk', 'both breasts').payload).toMatchObject({ leftSeconds: 300, rightSeconds: 300 });
  });

  it('maps bottles, cup feeds and solids (solids win over odd methods)', () => {
    expect(feeding('breast milk', 'bottle', 90).payload).toMatchObject({ method: 'bottle', milkType: 'breast_milk', amountMl: 90 });
    expect(feeding('formula', 'parent fed', 60).payload).toMatchObject({ method: 'bottle', milkType: 'formula' });
    expect(feeding('solid food', 'self fed').payload).toMatchObject({ method: 'solids', feeder: 'self' });
    expect(feeding('solid food', 'right breast').payload).toMatchObject({ method: 'solids' });
  });

  it('keeps times, notes and a stable import ref', () => {
    const m = feeding('breast milk', 'left breast');
    expect(m.startedAt).toBe(Date.parse('2026-04-11T06:28:00Z'));
    expect(m.endedAt).toBe(Date.parse('2026-04-11T06:38:00Z'));
    expect(m.importRef).toBe('babybuddy:bb.example:feedings:7');
    expect(m.payload.notes).toBe('n');
  });

  it('maps diapers including dry and unknown colors', () => {
    const c = (wet: boolean, solid: boolean, color = '') =>
      mapRecord('changes', { ...base, time: '2026-10-19T10:00:00Z', wet, solid, color, amount: null }, H, METRIC).payload;
    expect(c(true, true, 'brown')).toMatchObject({ condition: 'both', color: 'brown' });
    expect(c(false, false)).toMatchObject({ condition: 'dry', color: undefined });
  });

  it('converts measurements by the chosen units', () => {
    const imperial: ImportUnits = { volume: 'oz', weight: 'lb', length: 'in', temperature: 'f' };
    expect(mapRecord('weight', { ...base, date: '2025-11-10', weight: 14260 }, H, METRIC).payload).toMatchObject({ weightG: 14260 });
    expect(mapRecord('weight', { ...base, date: '2025-11-10', weight: 10 }, H, imperial).payload).toMatchObject({ weightG: 4536 });
    expect(mapRecord('height', { ...base, date: '2025-11-10', height: 20 }, H, imperial).payload).toMatchObject({ heightCm: 50.8 });
    expect(mapRecord('temperature', { ...base, time: '2025-01-24T11:37:00Z', temperature: 98.6 }, H, imperial).payload).toMatchObject({ celsius: 37 });
    expect(mapRecord('pumping', { ...base, start: '2025-01-01T09:33:00Z', end: '2025-01-01T09:40:00Z', amount: 2 }, H, imperial).payload).toMatchObject({ amountMl: 59 });
  });

  it('maps medication intervals and parses durations', () => {
    expect(bbDurationMinutes('06:00:00')).toBe(360);
    expect(bbDurationMinutes('1 02:30:00')).toBe(1590);
    const m = mapRecord('medication', { ...base, time: '2026-01-01T08:00:00Z', name: 'Paracetamol', dosage: 2.5, dosage_unit: 'ml', next_dose_interval: '06:00:00' }, H, METRIC);
    expect(m.payload).toMatchObject({ name: 'Paracetamol', dose: 2.5, unit: 'ml', nextDoseIntervalMin: 360 });
  });

  it('detects units from magnitudes', () => {
    expect(detectUnits({ volume: [60, 90], weight: [3715, 14260], length: [85], head: [47], temperature: [37] }, 'metric'))
      .toEqual(METRIC);
    expect(detectUnits({ volume: [3, 4], weight: [12, 20], length: [30], head: [17], temperature: [99] }, 'imperial'))
      .toEqual({ volume: 'oz', weight: 'lb', length: 'in', temperature: 'f' });
  });
});

// Opt-in: map a full real export (BB_DUMP=/path/all.json, keyed by endpoint) and validate every row.
// Real data is kept outside the repo.
const dump = process.env.BB_DUMP;
describe.skipIf(!dump || !existsSync(dump))('Baby Buddy real export', () => {
  it('maps every record to a valid, complete payload', () => {
    const data = JSON.parse(readFileSync(dump!, 'utf8')) as Partial<Record<BBEndpoint, unknown[]>>;
    let n = 0;
    const failures: string[] = [];
    for (const e of BB_ENDPOINTS) {
      for (const r of data[e] ?? []) {
        n++;
        try {
          const m = mapRecord(e, r as never, H, METRIC);
          if (!LogPayloadSchema.safeParse(m.payload).success || !isCompletePayload(m.payload)) failures.push(m.importRef);
          if (m.endedAt !== null && m.endedAt < m.startedAt) failures.push(`${m.importRef} ends before start`);
        } catch (err) {
          failures.push(`${e}:${(r as { id: number }).id} ${String(err)}`);
        }
      }
    }
    console.log(`mapped ${n} records, ${failures.length} failures`);
    expect(failures.slice(0, 10)).toEqual([]);
  });
});
