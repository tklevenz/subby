import { describe, expect, it } from 'vitest';
import { appendEntry, formerSelves, installTag, newIdentity, newSymmetricKey, verifyDeviceLog, type DeviceLogEntry, type IdentityKeys } from '../crypto';

const pub = (k: IdentityKeys) => ({ sign: k.sign.publicKey, box: k.box.publicKey });
const ids = { a: 'a0000000-0000-4000-8000-000000000000', b: 'b0000000-0000-4000-8000-000000000000', c: 'c0000000-0000-4000-8000-000000000000' };

/** a creates the family and adds b, then c joins with `cKeys`. */
function family(cKeys: IdentityKeys, bKeys = newIdentity()) {
  const a = { id: ids.a, keys: newIdentity() };
  const log: DeviceLogEntry[] = [];
  const append = (change: Parameters<typeof appendEntry>[3]) => log.push(appendEntry(log.length ? verifyDeviceLog(log) : null, log.length, a, change, Date.now()));
  append({ type: 'create', deviceId: a.id, keys: pub(a.keys), familyKey: { epoch: 1, key: newSymmetricKey() } });
  append({ type: 'add', deviceId: ids.b, keys: pub(bKeys) });
  append({ type: 'add', deviceId: ids.c, keys: pub(cKeys) });
  return { state: verifyDeviceLog(log), bKeys };
}

describe('installTag', () => {
  it('is a stable hash that hides the id', () => {
    expect(installTag('dd96dec43fb81c97')).toBe(installTag('dd96dec43fb81c97'));
    expect(installTag('dd96dec43fb81c97')).not.toBe(installTag('dd96dec43fb81c98'));
    expect(installTag('dd96dec43fb81c97')).toMatch(/^[0-9a-f]{64}$/);
    expect(installTag('dd96dec43fb81c97')).not.toContain('dd96dec43fb81c97');
  });
});

describe('formerSelves', () => {
  it('finds the old entry with the same tag (Android, storage cleared)', () => {
    const { state } = family(newIdentity());
    const tag = installTag('pixel-7');
    expect(formerSelves(state, ids.c, tag, { [ids.b]: tag, [ids.a]: installTag('pixel-10') })).toEqual([ids.b]);
  });

  it('finds the old entry with the same signing key (iOS keeps it across reinstalls)', () => {
    const keys = newIdentity();
    const { state } = family(keys, keys);
    expect(formerSelves(state, ids.c, null, {})).toEqual([ids.b]);
    // Never the other way round: the newer entry is the one in use.
    expect(formerSelves(state, ids.b, null, {})).toEqual([]);
  });

  it('finds nothing for other phones, without a tag, or when this phone is not a member', () => {
    const { state } = family(newIdentity());
    const tag = installTag('pixel-7');
    expect(formerSelves(state, ids.c, tag, { [ids.a]: installTag('other'), [ids.b]: installTag('another') })).toEqual([]);
    expect(formerSelves(state, ids.c, null, { [ids.b]: tag })).toEqual([]);
    expect(formerSelves(state, 'd0000000-0000-4000-8000-000000000000', tag, { [ids.b]: tag })).toEqual([]);
    // A phone that joined later never counts.
    expect(formerSelves(state, ids.b, tag, { [ids.c]: tag })).toEqual([]);
    // Its own tag never counts.
    expect(formerSelves(state, ids.c, tag, { [ids.c]: tag })).toEqual([]);
  });
});
