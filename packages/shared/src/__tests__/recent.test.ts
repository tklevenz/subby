import { describe, expect, it } from 'vitest';
import { flaggedFoods, medicationsDue, recentFoods, pumpingDue, recentMedications } from '../domain/recent';
import { MILESTONES } from '../domain/milestones';
import { desc, entry } from './fixtures';

const H = 3_600_000;

describe('recent values', () => {
  const logs = desc([
    entry({ type: 'feed', method: 'solids', foods: ['Carrot', 'banana'] }, 1 * H, 1 * H),
    entry({ type: 'feed', method: 'solids', foods: ['carrot', 'egg'], allergen: true }, 2 * H, 2 * H),
    entry({ type: 'medication', name: 'Paracetamol', dose: 2.5, unit: 'ml', nextDoseIntervalMin: 360 }, 3 * H),
    entry({ type: 'medication', name: 'Vitamin D', dose: 1, unit: 'drops' }, 4 * H),
    entry({ type: 'medication', name: 'paracetamol', dose: 3, unit: 'ml', nextDoseIntervalMin: 360 }, 5 * H),
  ]);

  it('dedupes foods case-insensitively, newest first', () => {
    expect(recentFoods(logs)).toEqual(['carrot', 'egg', 'banana']);
    expect(flaggedFoods(logs)).toEqual(['carrot', 'egg']);
  });

  it('keeps the latest dose per medication', () => {
    expect(recentMedications(logs).map((m) => [m.name, m.dose])).toEqual([['paracetamol', 3], ['Vitamin D', 1]]);
    expect(medicationsDue(logs)).toEqual([
      { name: 'paracetamol', lastAt: 5 * H, dueAt: 11 * H, last: { type: 'medication', name: 'paracetamol', dose: 3, unit: 'ml', nextDoseIntervalMin: 360 } },
    ]);
  });

  it('has unique milestone keys', () => {
    expect(new Set(MILESTONES.map((m) => m.key)).size).toBe(MILESTONES.length);
  });
});

describe('pumpingDue', () => {
  it('is the last session\'s start plus the interval, in any order', () => {
    const logs = [entry({ type: 'pumping' }, 5 * H, 5.5 * H), entry({ type: 'feed', method: 'bottle' }, 6 * H, 6 * H), entry({ type: 'pumping' }, 1 * H, 1.5 * H)];
    expect(pumpingDue(logs, 180)).toEqual({ lastAt: 5 * H, dueAt: 8 * H });
  });

  it('is nothing without a session, or while one is running', () => {
    expect(pumpingDue([entry({ type: 'feed', method: 'bottle' }, H, H)], 180)).toBeNull();
    expect(pumpingDue([entry({ type: 'pumping' }, 1 * H, 1.5 * H), entry({ type: 'pumping' }, 5 * H)], 180)).toBeNull();
  });
});
