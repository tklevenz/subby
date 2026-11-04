import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import {
  BackupError,
  decryptBackup,
  encryptBackup,
  isEncryptedBackup,
  makeBackup,
  planRestore,
  readBackup,
} from '../domain/backup';
import type { Child } from '../schemas/child.schema';
import { entry } from './fixtures';

const t = new Date(2026, 9, 10, 8, 0).getTime();
const child: Child = {
  id: '0190a000-0000-7000-8000-000000000000',
  name: 'Emma',
  birthDate: '2026-03-01',
  birthTime: null,
  dueDate: null,
  sex: 'female',
  photoUri: 'file:///data/photos/123.jpg',
  photoBlob: { id: '0190a000-0000-7000-9000-000000000001', key: 'abc' },
  updatedAt: t,
  isDeleted: false,
  syncStatus: 'synced',
  importRef: null,
};
const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3]);
const note = { ...entry({ type: 'note', text: 'First smile', photoUri: 'file:///data/photos/9.png' }, t), syncStatus: 'synced' as const };
const feed = entry({ type: 'feed', method: 'bottle', amountMl: 120 }, t + 1000, t + 1000);
const gone = { ...entry({ type: 'diaper', condition: 'wet' }, t), isDeleted: true };

const build = () =>
  makeBackup({
    children: [child],
    logs: [note, feed, gone],
    photos: new Map([['file:///data/photos/123.jpg', jpeg], ['file:///data/photos/9.png', jpeg]]),
    createdAt: t,
  });

describe('backup', () => {
  it('round-trips rows and photos without device-local fields', () => {
    const { backup, photos, invalid } = readBackup(build());
    expect(invalid).toBe(0);
    expect(backup.children).toHaveLength(1);
    expect(backup.children[0]).not.toHaveProperty('photoUri');
    expect(backup.children[0]).not.toHaveProperty('photoBlob');
    expect(photos.get(backup.children[0].photo!)).toEqual(jpeg);
    const restoredNote = backup.logs.find((l) => l.id === note.id)!;
    expect(restoredNote.payload).toEqual({ type: 'note', text: 'First smile' });
    expect(photos.get(restoredNote.photo!)).toEqual(jpeg);
    expect(restoredNote.photo).toMatch(/\.png$/);
    expect(backup.logs.find((l) => l.id === feed.id)).toMatchObject({ payload: feed.payload, startedAt: feed.startedAt, endedAt: feed.endedAt });
    expect(backup.deleted).toEqual([{ kind: 'log', id: gone.id, updatedAt: gone.updatedAt }]);
  });

  it('skips bad rows, ignores stray files and rejects other files', () => {
    const files = unzipSync(build());
    const manifest = JSON.parse(new TextDecoder().decode(files['backup.json']));
    manifest.logs.push({ id: 'nope' }, { ...manifest.logs[1], payload: { type: 'sleep' } });
    manifest.children[0].photo = '../../SQLite/kindred.db';
    const zip = zipSync({ ...files, 'backup.json': strToU8(JSON.stringify(manifest)) });
    const res = readBackup(zip);
    expect(res.invalid).toBe(3); // the child (bad photo path) and two logs
    expect(res.backup.logs).toHaveLength(2);

    expect(() => readBackup(strToU8('hello'))).toThrow(BackupError);
    expect(() => readBackup(zipSync({ 'other.txt': strToU8('x') }))).toThrow(/not a Subby backup/);
    // Files a backup doesn't have are left packed, and a zip that would inflate far beyond its size is refused.
    const extra = zipSync({ ...files, 'photos/../../x': strToU8('x'), 'junk.bin': new Uint8Array(1000) });
    expect(readBackup(extra).backup.logs).toHaveLength(2);
    const bomb = zipSync({ ...files, 'photos/9.jpg': new Uint8Array(80 * 2 ** 20) }, { level: 9 });
    expect(() => readBackup(bomb)).toThrow(/damaged/);
    const newer = zipSync({ 'backup.json': strToU8(JSON.stringify({ ...manifest, version: 99 })) });
    expect(() => readBackup(newer)).toThrow(/newer version/);
  });

  it('encrypts with a passphrase', async () => {
    const zip = build();
    const kdf = { logN: 10, r: 8, p: 1 }; // fast for tests
    const box = await encryptBackup(zip, 'correct horse', undefined, kdf);
    expect(isEncryptedBackup(box)).toBe(true);
    expect(isEncryptedBackup(zip)).toBe(false);
    expect(await decryptBackup(box, 'correct horse')).toEqual(zip);
    await expect(decryptBackup(box, 'wrong horse')).rejects.toThrow(/Wrong passphrase/);
    const tampered = box.slice();
    tampered[tampered.length - 1] ^= 1;
    await expect(decryptBackup(tampered, 'correct horse')).rejects.toThrow(BackupError);
    const greedy = box.slice();
    greedy[5] = 30; // N = 2^30
    await expect(decryptBackup(greedy, 'correct horse')).rejects.toThrow(/damaged/);
    const wide = box.slice();
    [wide[5], wide[6]] = [20, 16]; // 2 GiB of memory
    await expect(decryptBackup(wide, 'correct horse')).rejects.toThrow(/damaged/);
  });

  it('plans a restore with newest-edit-wins', () => {
    const { backup } = readBackup(build());
    const deletedHere = { ...feed, updatedAt: t + 5000 };
    const plan = planRestore(backup, {
      children: new Map([[child.id, { updatedAt: t - 1, isDeleted: false }]]), // older here: restored
      logs: new Map([
        [note.id, { updatedAt: note.updatedAt, isDeleted: false }], // same: unchanged
        [feed.id, { updatedAt: deletedHere.updatedAt, isDeleted: true }], // deleted here later: stays deleted
        [gone.id, { updatedAt: gone.updatedAt - 1, isDeleted: false }], // deleted in the backup later: deleted
      ]),
    });
    expect(plan.children.map((c) => c.id)).toEqual([child.id]);
    expect(plan.logs).toEqual([]);
    expect(plan.deletions.map((d) => d.id)).toEqual([gone.id]);
    expect(plan.unchanged).toBe(2);

    const fresh = planRestore(backup, { children: new Map(), logs: new Map() });
    expect([fresh.children.length, fresh.logs.length, fresh.deletions.length, fresh.unchanged]).toEqual([1, 2, 0, 0]);
  });

  it('takes only the newest version of a row a (hand-edited) backup has twice', () => {
    const { backup } = readBackup(build());
    const live = backup.logs[0]!;
    const tomb = (updatedAt: number) => ({ kind: 'log' as const, id: live.id, updatedAt });
    const local = { children: new Map(), logs: new Map([[live.id, { updatedAt: live.updatedAt - 10, isDeleted: false }]]) };
    // A newer tombstone wins over the entry: deleted, not restored.
    const deleted = planRestore({ ...backup, deleted: [tomb(live.updatedAt + 1)] }, local);
    expect(deleted.logs.map((l) => l.id)).not.toContain(live.id);
    expect(deleted.deletions.map((d) => d.id)).toEqual([live.id]);
    // An older one loses: restored, not deleted afterwards.
    const restored = planRestore({ ...backup, deleted: [tomb(live.updatedAt - 1)], logs: [...backup.logs, { ...live, updatedAt: live.updatedAt - 5 }] }, local);
    expect(restored.logs.filter((l) => l.id === live.id)).toEqual([live]);
    expect(restored.deletions).toEqual([]);
  });
});
