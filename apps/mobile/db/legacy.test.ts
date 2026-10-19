import { describe, expect, it } from 'vitest';
import { LogEntrySchema } from '@kindred-log/shared';
import { upgradeLegacyRow, type LegacyLogRow } from './legacy';

const row = (payload: object, started_at = 1_000_000): LegacyLogRow => ({
  id: '0190a000-0000-7000-8000-000000000001',
  child_id: '0190a000-0000-7000-8000-000000000000',
  log_type: (payload as { type: string }).type,
  started_at,
  updated_at: started_at,
  is_deleted: 0,
  sync_status: 'pending',
  payload: JSON.stringify(payload),
});

describe('upgradeLegacyRow', () => {
  it('moves sleep endedAt to the column', () => {
    const e = upgradeLegacyRow(row({ type: 'sleep', endedAt: 2_000_000 }));
    expect(e.endedAt).toBe(2_000_000);
    expect(e.payload).toEqual({ type: 'sleep', notes: undefined });
    expect(upgradeLegacyRow(row({ type: 'sleep', endedAt: null })).endedAt).toBeNull();
  });

  it('converts breast sides and sets feed end', () => {
    const left = upgradeLegacyRow(row({ type: 'feed', method: 'breast_left', durationSeconds: 600 }));
    expect(left.payload).toMatchObject({ method: 'breast', leftSeconds: 600, lastSide: 'left' });
    expect(left.endedAt).toBe(1_000_000 + 600_000);

    const both = upgradeLegacyRow(row({ type: 'feed', method: 'breast_both', durationSeconds: 601 }));
    expect(both.payload).toMatchObject({ leftSeconds: 301, rightSeconds: 300 });

    const bottle = upgradeLegacyRow(row({ type: 'feed', method: 'bottle', amountMl: 90 }));
    expect(bottle.payload).toMatchObject({ method: 'bottle', amountMl: 90 });
    expect(bottle.endedAt).toBe(1_000_000);
  });

  it('keeps diapers as point events and produces valid entries', () => {
    const d = upgradeLegacyRow(row({ type: 'diaper', condition: 'wet' }));
    expect(d.endedAt).toBeNull();
    for (const e of [d, upgradeLegacyRow(row({ type: 'sleep', endedAt: 5 }))]) {
      expect(LogEntrySchema.safeParse(e).success).toBe(true);
    }
  });
});
