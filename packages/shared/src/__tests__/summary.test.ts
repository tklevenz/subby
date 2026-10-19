import { describe, expect, it } from 'vitest';
import { LogEntrySchema } from '../schemas/log.schema';
import {
  activeSleep, activeTimers, describeFeed, lastOfType, lastWakeAt, suggestedNextSide,
} from '../domain/summary';
import { desc, entry } from './fixtures';

const H = 3_600_000;

describe('summary', () => {
  const logs = desc([
    entry({ type: 'sleep', nap: false }, 0, 8 * H),
    entry({ type: 'feed', method: 'breast', leftSeconds: 600, lastSide: 'left' }, 8 * H, 8 * H + 600_000),
    entry({ type: 'diaper', condition: 'wet' }, 9 * H),
    entry({ type: 'feed', method: 'bottle', amountMl: 90, milkType: 'formula' }, 10 * H, 10 * H),
    entry({ type: 'pumping', amountMl: 80 }, 11 * H, null),
  ]);

  it('fixtures satisfy the entry schema', () => {
    for (const l of logs) expect(LogEntrySchema.safeParse(l).success).toBe(true);
  });

  it('finds latest by type', () => {
    expect(lastOfType(logs, 'feed')?.payload.method).toBe('bottle');
    expect(lastOfType(logs, 'temperature')).toBeUndefined();
  });

  it('treats only open timed entries as running', () => {
    expect(activeTimers(logs).map((l) => l.logType)).toEqual(['pumping']);
    expect(activeSleep(logs)).toBeUndefined();
  });

  it('computes wake window start and next side', () => {
    expect(lastWakeAt(logs)).toBe(8 * H);
    expect(suggestedNextSide(logs)).toBe('right');
  });

  it('describes feeds', () => {
    expect(describeFeed({ type: 'feed', method: 'bottle', amountMl: 90, milkType: 'formula' })).toBe('Formula · 90 ml');
    expect(describeFeed({ type: 'feed', method: 'breast', leftSeconds: 300, rightSeconds: 300 })).toBe('Both sides · 10 min');
    expect(describeFeed({ type: 'feed', method: 'solids', foods: ['carrot'] })).toBe('Solids · carrot');
  });
});
