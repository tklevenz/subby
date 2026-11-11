import { describe, expect, it } from 'vitest';
import { regionalDefaults } from './regional';

describe('regionalDefaults', () => {
  it('follows a US phone', () => {
    expect(regionalDefaults({ measurementSystem: 'us', uses24hourClock: false })).toEqual({ units: 'imperial', clock: '12h' });
  });

  it('keeps metric for the UK, with its clock', () => {
    expect(regionalDefaults({ measurementSystem: 'uk', uses24hourClock: true })).toEqual({ units: 'metric', clock: '24h' });
  });

  it('falls back to metric and 24-hour when the phone says nothing', () => {
    expect(regionalDefaults({})).toEqual({ units: 'metric', clock: '24h' });
    expect(regionalDefaults({ measurementSystem: null, uses24hourClock: null })).toEqual({ units: 'metric', clock: '24h' });
  });
});
