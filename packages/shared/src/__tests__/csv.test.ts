import { describe, expect, it } from 'vitest';
import { csvCell, logsToCsv } from '../domain/csv';
import { entry } from './fixtures';

const t = new Date(2026, 9, 10, 8, 5).getTime();

describe('logsToCsv', () => {
  it('writes only used columns, oldest first, with durations', () => {
    const csv = logsToCsv(
      [
        entry({ type: 'diaper', condition: 'wet' }, t + 3_600_000),
        entry({ type: 'feed', method: 'breast', leftSeconds: 600 }, t, t + 600_000),
      ],
      'Emma',
    );
    expect(csv.trim().split('\n')).toEqual([
      'child,type,start,end,duration_min,method,left_min,condition',
      'Emma,feed,2026-10-10 08:05,2026-10-10 08:15,10,breast,10,',
      'Emma,diaper,2026-10-10 09:05,,,,,wet',
    ]);
  });

  it('quotes and defuses formulas', () => {
    expect(csvCell('a, "b"')).toBe('"a, ""b"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(-3)).toBe('-3');
    for (const v of [' =1+1', '\n=1+1', '|cmd', '\t@x']) expect(csvCell(v)).toMatch(/^"?'/);
  });
});
