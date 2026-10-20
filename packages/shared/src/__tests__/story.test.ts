import { describe, expect, it } from 'vitest';
import { childStory } from '../domain/story';
import { entry } from './fixtures';

const day = (d: number) => new Date(2026, 4, d, 12).getTime();
const child = { birthDate: '2026-05-03' };

describe('childStory', () => {
  it('lists firsts newest first, ending with the birth', () => {
    const logs = [
      entry({ type: 'milestone', key: 'laughs' }, day(20)),
      entry({ type: 'growth', weightG: 7100, heightCm: 66 }, day(25)),
      entry({ type: 'feed', method: 'solids', foods: ['pear'] }, day(28)),
      entry({ type: 'feed', method: 'solids', foods: ['carrot'] }, day(22)),
      entry({ type: 'milestone', custom: '  First swim ' }, day(30)),
    ];
    const story = childStory(logs, child, 'metric');
    expect(story.map((s) => s.title)).toEqual([
      'First swim',
      'Measured 7.1 kg, 66 cm',
      'First solid food: carrot',
      'Laughs',
      'Born',
    ]);
    expect(story.at(-1)).toMatchObject({ kind: 'birth', logId: null, at: new Date(2026, 4, 3).getTime() });
  });

  it('skips deleted entries and empty measurements', () => {
    const deleted = { ...entry({ type: 'milestone', key: 'laughs' }, day(20)), isDeleted: true };
    const empty = entry({ type: 'growth' }, day(21));
    expect(childStory([deleted, empty], child, 'metric').map((s) => s.kind)).toEqual(['birth']);
  });

  it('formats measurements in the chosen units', () => {
    const story = childStory([entry({ type: 'growth', headCm: 42.5 }, day(21))], child, 'imperial');
    expect(story[0].title).toBe('Measured head 16.7 in');
  });
});
