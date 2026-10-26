import { describe, expect, it } from 'vitest';
import { LogEntrySchema } from '../schemas/log.schema';
import {
  activeSleep, activeTimers, describeFeed, lastOfType, lastWakeAt, overlappingSleep, suggestedNextSide,
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

describe('overlappingSleep', () => {
  const H = 3_600_000;
  const done = entry({ type: 'sleep', nap: true }, 10 * H, 12 * H);
  const running = entry({ type: 'sleep', nap: false }, 20 * H, null);
  const logs = [running, done, entry({ type: 'feed', method: 'bottle' }, 11 * H, 11 * H)];

  it('finds a finished sleep the new one overlaps, but not one it only touches', () => {
    expect(overlappingSleep(logs, 11 * H, 13 * H)?.id).toBe(done.id);
    expect(overlappingSleep(logs, 9 * H, 10.5 * H)?.id).toBe(done.id);
    expect(overlappingSleep(logs, 12 * H, 14 * H)).toBeUndefined();
    expect(overlappingSleep(logs, 8 * H, 10 * H)).toBeUndefined();
  });

  it('treats a running sleep as lasting until stopped, and a new one without an end as still going', () => {
    expect(overlappingSleep(logs, 21 * H, 22 * H)?.id).toBe(running.id);
    expect(overlappingSleep(logs, 13 * H, null)?.id).toBe(running.id);
    expect(overlappingSleep([done], 13 * H, null)).toBeUndefined();
    expect(overlappingSleep([done], 11 * H, null)?.id).toBe(done.id);
  });

  it('ignores the entry being edited and other types', () => {
    expect(overlappingSleep(logs, 10 * H, 12 * H, done.id)).toBeUndefined();
    expect(overlappingSleep(logs.slice(2), 10 * H, 12 * H)).toBeUndefined();
  });
});
