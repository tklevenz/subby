import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Child } from '@subby/shared';

/** What the database select in `downloadPhotos` returns: children first, then notes. */
let selects: unknown[][] = [];
const chain = (rows: () => unknown[]) => {
  const c: Record<string, unknown> = {};
  for (const k of ['from', 'set']) c[k] = () => c;
  c.where = () => Object.assign(Promise.resolve(rows()), { changes: 1 });
  return c;
};
vi.mock('../../db/client', () => ({
  db: {
    update: () => chain(() => [] as unknown[]),
    select: () => chain(() => selects.shift() ?? []),
  },
  schema: { childrenTable: {}, logsTable: {} },
}));
vi.mock('drizzle-orm', () => ({ and: () => null, eq: () => null, isNotNull: () => null, isNull: () => null, sql: Object.assign(() => null, { raw: () => null }) }));
vi.mock('../photos', () => ({
  deletePhoto: () => {},
  photoSize: () => 10,
  readPhotoBytes: async () => new Uint8Array([1, 2, 3]),
  savePhotoBytes: (name: string) => `saved/${name}`,
}));
class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}
vi.mock('./api', () => ({
  isHttpError: (e: unknown, ...statuses: number[]) => e instanceof HttpError && statuses.includes(e.status),
}));

const { downloadPhotos, uploadPhotos } = await import('./photos');

const child = (id: string): Child => ({
  id,
  name: 'Sam',
  birthDate: '2024-07-27',
  birthTime: null,
  dueDate: null,
  sex: null,
  photoUri: `${id}.jpg`,
  photoBlob: null,
  updatedAt: 1000,
  isDeleted: false,
  syncStatus: 'pending',
  importRef: null,
} as unknown as Child);

describe('photos and a busy server (429)', () => {
  beforeEach(() => {
    selects = [];
  });

  it('holds the rows whose photo it was too busy to take, without failing the run', async () => {
    const putBlob = vi.fn(async () => {
      throw new HttpError(429);
    });
    const rows = [child('a'), child('b')];
    const result = await uploadPhotos({ putBlob } as never, rows, []);
    expect(result.busy).toEqual(['a', 'b']);
    // Once busy, the others wait without asking again.
    expect(putBlob).toHaveBeenCalledTimes(1);
    // Nothing on the rows changed: they still need their photo uploaded.
    expect(rows.every((r) => r.photoBlob === null && r.photoUri)).toBe(true);
  });

  it('still fails the run on other errors', async () => {
    const putBlob = async () => {
      throw new HttpError(500);
    };
    await expect(uploadPhotos({ putBlob } as never, [child('a')], [])).rejects.toThrow('HTTP 500');
  });

  it('leaves downloads for the next run when the server is busy', async () => {
    selects = [[{ id: 'a', blob: { id: '0190a000-0000-7000-8000-0000000000aa', key: 'AAAA' } }], []];
    const getBlob = vi.fn(async () => {
      throw new HttpError(429);
    });
    expect(await downloadPhotos({ getBlob } as never, () => {})).toBe(0);
    expect(getBlob).toHaveBeenCalledTimes(1);
  });
});
