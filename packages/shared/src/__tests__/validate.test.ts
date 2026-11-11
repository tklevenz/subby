import { describe, expect, it } from 'vitest';
import { isCompletePayload, isEmptySolids } from '../domain/validate';

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
