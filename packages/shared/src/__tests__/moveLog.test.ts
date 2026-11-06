import { describe, expect, it } from 'vitest';
import {
  RECOVERY_SIGNER,
  appendEntry,
  movedFamilyLog,
  newIdentity,
  newSymmetricKey,
  recoveryIdentity,
  newRecoveryWords,
  verifyDeviceLog,
  verifyMovedLog,
  type DeviceLogEntry,
  type IdentityKeys,
} from '../crypto';

const phone = (id: string) => ({ id, keys: newIdentity() });
const pub = (k: IdentityKeys) => ({ sign: k.sign.publicKey, box: k.box.publicKey });

/** An old family: a creates, adds b and c, sets a recovery key. */
function oldFamily() {
  const [a, b, c] = [phone('a0000000-0000-4000-8000-000000000000'), phone('b0000000-0000-4000-8000-000000000000'), phone('c0000000-0000-4000-8000-000000000000')];
  const recovery = recoveryIdentity(newRecoveryWords());
  const log: DeviceLogEntry[] = [];
  const append = (signer: typeof a, change: Parameters<typeof appendEntry>[3]) => {
    log.push(appendEntry(log.length ? verifyDeviceLog(log) : null, log.length, signer, change, Date.now()));
  };
  append(a, { type: 'create', deviceId: a.id, keys: pub(a.keys), familyKey: { epoch: 1, key: newSymmetricKey() } });
  append(a, { type: 'add', deviceId: b.id, keys: pub(b.keys) });
  append(a, { type: 'add', deviceId: c.id, keys: pub(c.keys) });
  append(a, { type: 'setRecovery', deviceId: RECOVERY_SIGNER, keys: pub(recovery) });
  return { a, b, c, recovery, log, append };
}

describe('moving a family', () => {
  it('builds a log with every phone and the recovery key, which the others accept', () => {
    const { a, b, c, recovery, log } = oldFamily();
    const moved = movedFamilyLog(verifyDeviceLog(log), b, newSymmetricKey(), Date.now());
    const state = verifyMovedLog(log, moved, b.id, c.id);
    expect([...state.members.keys()].sort()).toEqual([a.id, b.id, c.id].sort());
    expect(state.recovery?.signKey).toEqual(recovery.sign.publicKey);
    expect(state.epoch).toBe(1);
    expect(moved[0]!.signer).toBe(b.id);
  });

  it('still accepts once the mover (or another phone) left the old family by itself', () => {
    const { a, b, c, log, append } = oldFamily();
    const moved = movedFamilyLog(verifyDeviceLog(log), b, newSymmetricKey(), Date.now());
    append(b, { type: 'remove', deviceId: b.id });
    append(a, { type: 'remove', deviceId: a.id });
    expect(() => verifyMovedLog(log, moved, b.id, c.id)).not.toThrow();
  });

  it('refuses a phone another phone removed (a lost one) after the move', () => {
    const { a, b, c, log, append } = oldFamily();
    const moved = movedFamilyLog(verifyDeviceLog(log), b, newSymmetricKey(), Date.now());
    append(c, { type: 'remove', deviceId: a.id });
    expect(() => verifyMovedLog(log, moved, b.id, c.id)).toThrow(/removed/);
  });

  it('refuses a log made by someone outside the family, or with a stranger in it', () => {
    const { b, c, log } = oldFamily();
    const stranger = phone('d0000000-0000-4000-8000-000000000000');
    const fake = movedFamilyLog(verifyDeviceLog([...log]), b, newSymmetricKey(), Date.now());
    // Same ids, another key: a server (or anyone) can't stand in for b.
    const impostor = { id: b.id, keys: newIdentity() };
    const forged = movedFamilyLog(verifyDeviceLog(log), impostor, newSymmetricKey(), Date.now());
    expect(() => verifyMovedLog(log, forged, b.id, c.id)).toThrow(/isn’t in this family/);
    const withStranger = [...fake, appendEntry(verifyDeviceLog(fake), fake.length, b, { type: 'add', deviceId: stranger.id, keys: pub(stranger.keys) }, Date.now())];
    expect(() => verifyMovedLog(log, withStranger, b.id, c.id)).toThrow(/isn’t in this family/);
    expect(() => verifyMovedLog(log, fake, c.id, c.id)).toThrow(/wasn't made/);
  });

  it('refuses another recovery key, or a log without this phone', () => {
    const { b, c, log } = oldFamily();
    const moved = movedFamilyLog(verifyDeviceLog(log), b, newSymmetricKey(), Date.now());
    const other = recoveryIdentity(newRecoveryWords());
    const swapped = [...moved, appendEntry(verifyDeviceLog(moved), moved.length, b, { type: 'setRecovery', deviceId: RECOVERY_SIGNER, keys: pub(other) }, Date.now())];
    expect(() => verifyMovedLog(log, swapped, b.id, c.id)).toThrow(/recovery/);
    const withoutC = [...moved, appendEntry(verifyDeviceLog(moved), moved.length, b, { type: 'remove', deviceId: c.id }, Date.now())];
    expect(() => verifyMovedLog(log, withoutC, b.id, c.id)).toThrow(/doesn’t have this phone/);
  });

  it('only a member can move the family', () => {
    const { log } = oldFamily();
    expect(() => movedFamilyLog(verifyDeviceLog(log), phone('e0000000-0000-4000-8000-000000000000'), newSymmetricKey(), Date.now())).toThrow();
  });
});
