import { describe, expect, it } from 'vitest';
import { isCompletePayload } from '../domain/validate';

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
