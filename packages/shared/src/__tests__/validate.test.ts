import { describe, expect, it } from 'vitest';
import { isCompletePayload, isEmptySolids, endBeforeStart } from '../domain/validate';
import { notePhoto } from '../domain/photo';
import { hasStool } from '../schemas/log.schema';

describe('isCompletePayload', () => {
  it('rejects empty entries', () => {
    expect(isCompletePayload({ type: 'growth' })).toBe(false);
    expect(isCompletePayload({ type: 'milestone' })).toBe(false);
    expect(isCompletePayload({ type: 'note', text: '  ' })).toBe(false);
    expect(isCompletePayload({ type: 'medication', name: '' })).toBe(false);
    expect(isCompletePayload({ type: 'temperature', celsius: 98.6 })).toBe(false);
  });
  it('accepts complete entries', () => {
    expect(isCompletePayload({ type: 'growth', weightG: 4200 })).toBe(true);
    expect(isCompletePayload({ type: 'milestone', key: 'first_smile' })).toBe(true);
    expect(isCompletePayload({ type: 'diaper', condition: 'dry' })).toBe(true);
    expect(isCompletePayload({ type: 'temperature', celsius: 37.2 })).toBe(true);
  });
});

describe('isEmptySolids', () => {
  it('needs a food for a new solids feed', () => {
    expect(isEmptySolids({ type: 'feed', method: 'solids' })).toBe(true);
    expect(isEmptySolids({ type: 'feed', method: 'solids', foods: [' '] })).toBe(true);
    expect(isEmptySolids({ type: 'feed', method: 'solids', foods: ['Carrot'] })).toBe(false);
  });

  it('leaves other feeds and types alone', () => {
    expect(isEmptySolids({ type: 'feed', method: 'bottle', amountMl: 120 })).toBe(false);
    expect(isEmptySolids({ type: 'sleep' })).toBe(false);
  });
});

describe('endBeforeStart', () => {
  it('only an end before the start is wrong', () => {
    expect(endBeforeStart(1000, 999)).toBe(true);
    expect(endBeforeStart(1000, 1000)).toBe(false);
    expect(endBeforeStart(1000, 2000)).toBe(false);
    expect(endBeforeStart(1000, null)).toBe(false); // a running timer
  });
});

describe('notePhoto', () => {
  it('is a note\'s photo file, and nothing for other types', () => {
    expect(notePhoto({ type: 'note', text: 'x', photoUri: 'file:///p.jpg' })).toBe('file:///p.jpg');
    expect(notePhoto({ type: 'note', text: 'x' })).toBeUndefined();
    expect(notePhoto({ type: 'sleep' })).toBeUndefined();
  });
});

describe('hasStool', () => {
  it('is dirty and both', () => {
    expect(hasStool('dirty')).toBe(true);
    expect(hasStool('both')).toBe(true);
    expect(hasStool('wet')).toBe(false);
    expect(hasStool('dry')).toBe(false);
  });
});
