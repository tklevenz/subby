import { describe, expect, it } from 'vitest';
import { flaggedFoods, medicationsDue, recentFoods, recentMedications, recentShortcuts } from '../domain/recent';
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
    expect(medicationsDue(logs)).toEqual([{ name: 'paracetamol', lastAt: 5 * H, dueAt: 11 * H }]);
  });

  it('has unique milestone keys', () => {
    expect(new Set(MILESTONES.map((m) => m.key)).size).toBe(MILESTONES.length);
  });
});

describe('recentShortcuts', () => {
  const at = (h: number) => h * H;
  it('falls back to Pump, Meds, Tummy without history', () => {
    expect(recentShortcuts([])).toEqual(['pumping', 'medication', 'tummy']);
  });

  it('puts the most recently logged categories first, skipping the big three and duplicates', () => {
    const logs = [
      entry({ type: 'growth', weightG: 9000 }, at(1)),
      entry({ type: 'sleep' }, at(5), at(6)),
      entry({ type: 'temperature', celsius: 37.2 }, at(4)),
      entry({ type: 'growth', weightG: 9100 }, at(3)),
      entry({ type: 'diaper', condition: 'wet' }, at(7)),
    ];
    expect(recentShortcuts(logs)).toEqual(['temperature', 'growth', 'pumping']);
  });

  it('tells tummy time apart from other activities', () => {
    const logs = [
      entry({ type: 'activity', kind: 'bath' }, at(3), at(3)),
      entry({ type: 'activity', kind: 'tummy_time' }, at(2), at(2)),
      entry({ type: 'note', text: 'hi' }, at(1)),
    ];
    expect(recentShortcuts(logs)).toEqual(['activity', 'tummy', 'note']);
  });
});
