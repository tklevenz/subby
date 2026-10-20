import { describe, expect, it, vi } from 'vitest';

// The store module opens SQLite on import; only the pure limit check is under test.
vi.mock('../db/client', () => ({ db: {}, schema: {} }));
vi.mock('../features/photos', () => ({ deletePhoto: () => {} }));
vi.mock('./useSettingsStore', () => ({ useSettingsStore: { getState: () => ({ isPremium: false }) } }));

const { canAddChild, FREE_CHILD_LIMIT } = await import('./useChildStore');

describe('child limit', () => {
  it('allows one child for free, any number with Premium', () => {
    expect(FREE_CHILD_LIMIT).toBe(1);
    expect(canAddChild(0, false)).toBe(true);
    expect(canAddChild(1, false)).toBe(false);
    expect(canAddChild(5, true)).toBe(true);
  });
});
