import { beforeAll, describe, expect, it } from 'vitest';
import { BB_ENDPOINTS, detectUnits, mapRecord } from '@subby/shared';
import { BBClient, BBError, nextOffset, normalizeBaseUrl } from './client';

describe('normalizeBaseUrl', () => {
  it('adds https and strips trailing slashes and /api', () => {
    expect(normalizeBaseUrl(' bb.example.com/ ')).toBe('https://bb.example.com');
    expect(normalizeBaseUrl('http://10.0.0.2:8000/api/')).toBe('http://10.0.0.2:8000');
  });
});

describe('nextOffset', () => {
  it('takes only the offset from the next link, and only forward', () => {
    expect(nextOffset('http://internal:8000/api/feedings/?limit=500&offset=500', 0)).toBe(500);
    expect(nextOffset('https://evil.example/steal?offset=1000&limit=500', 500)).toBe(1000);
    expect(nextOffset('http://bb/api/feedings/?limit=500&offset=500', 500)).toBeNull();
    expect(nextOffset('http://bb/api/feedings/?limit=500', 0)).toBeNull();
    expect(nextOffset(null, 0)).toBeNull();
  });
});

// Opt-in, read-only: BB_URL=… BB_TOKEN=… pnpm vitest run client
const { BB_URL, BB_TOKEN } = process.env;
describe.skipIf(!BB_URL || !BB_TOKEN)('Baby Buddy live server (read-only)', () => {
  // Built lazily: the describe body runs even when the suite is skipped.
  let client: BBClient;
  beforeAll(() => {
    client = new BBClient(BB_URL!, BB_TOKEN!);
  });

  it('rejects a bad key with a readable error', async () => {
    await expect(new BBClient(BB_URL!, 'nope').profile()).rejects.toBeInstanceOf(BBError);
  });

  it('pages through every endpoint and maps every record', async () => {
    let total = 0;
    for (const e of BB_ENDPOINTS) {
      const expected = await client.count(e);
      let seen = 0;
      for await (const page of client.pages(e)) {
        for (const r of page.results) mapRecord(e, r, client.host, { volume: 'ml', weight: 'g', length: 'cm', temperature: 'c' });
        seen += page.results.length;
      }
      expect(seen, e).toBe(expected);
      total += seen;
    }
    console.log(`paged + mapped ${total} records from ${client.host}`);
  }, 120_000);

  it('detects units from recent samples', async () => {
    const [w, h, t] = await Promise.all([client.sample('weight'), client.sample('head-circumference'), client.sample('temperature')]);
    console.log('detected', detectUnits({ volume: [], weight: w.map((x) => x.weight), length: [], head: h.map((x) => x.head_circumference), temperature: t.map((x) => x.temperature) }, 'metric'));
  });
});
