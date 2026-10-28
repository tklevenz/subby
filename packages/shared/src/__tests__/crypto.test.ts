import { describe, expect, it } from 'vitest';
import {
  FILE_CHUNK,
  RECOVERY_SIGNER,
  appendEntry,
  assertLogContinues,
  bytesToHex,
  decrypt,
  decryptFile,
  encrypt,
  encryptFile,
  fromBase64,
  isValidRecoveryWords,
  newIdentity,
  newRecoveryWords,
  newSymmetricKey,
  openFamilyKey,
  openSealed,
  pairingCode,
  recoveryIdentity,
  seal,
  toBase64,
  utf8ToBytes,
  verifyDeviceLog,
  withinEpoch,
  type DeviceLogEntry,
  type IdentityKeys,
} from '../crypto';

describe('base64url', () => {
  it('matches Node for every length and round-trips', () => {
    for (let n = 0; n < 70; n++) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + n) & 255);
      const text = toBase64(bytes);
      expect(text).toBe(Buffer.from(bytes).toString('base64url'));
      expect(fromBase64(text)).toEqual(bytes);
    }
  });

  it('rejects junk', () => {
    expect(() => fromBase64('ab+c')).toThrow();
    expect(() => fromBase64('a')).toThrow();
  });
});

describe('encrypt / decrypt', () => {
  const key = newSymmetricKey();
  const text = utf8ToBytes('fed 120 ml at 03:12');

  it('round-trips with a fresh nonce each time', () => {
    const a = encrypt(key, text);
    const b = encrypt(key, text);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
    expect(decrypt(key, a)).toEqual(text);
  });

  it('fails on a wrong key, wrong AAD or any flipped byte', () => {
    const box = encrypt(key, text, utf8ToBytes('meta'));
    expect(() => decrypt(newSymmetricKey(), box, utf8ToBytes('meta'))).toThrow();
    expect(() => decrypt(key, box, utf8ToBytes('other'))).toThrow();
    const tampered = box.slice();
    tampered[30] ^= 1;
    expect(() => decrypt(key, tampered, utf8ToBytes('meta'))).toThrow();
  });
});

describe('sealed boxes', () => {
  it('only the recipient can open', () => {
    const alice = newIdentity();
    const familyKey = newSymmetricKey();
    const box = seal(alice.box.publicKey, familyKey);
    expect(openSealed(alice, box)).toEqual(familyKey);
    expect(() => openSealed(newIdentity(), box)).toThrow();
  });
});

describe('recovery words', () => {
  // BIP39 test entropy 0x00…00 → "abandon … art". Pins the derivation so it never changes across versions.
  const ZERO_WORDS = `${'abandon '.repeat(23)}art`;

  it('derives a stable identity (test vector)', () => {
    const id = recoveryIdentity(ZERO_WORDS);
    expect(bytesToHex(id.sign.publicKey)).toBe(SIGN_VECTOR);
    expect(bytesToHex(id.box.publicKey)).toBe(BOX_VECTOR);
  });

  it('generates 24 valid words and tolerates sloppy typing', () => {
    const words = newRecoveryWords();
    expect(words.split(' ')).toHaveLength(24);
    const sloppy = `  ${words.toUpperCase().split(' ').join('\n  ')} `;
    expect(isValidRecoveryWords(sloppy)).toBe(true);
    expect(bytesToHex(recoveryIdentity(sloppy).sign.publicKey)).toBe(bytesToHex(recoveryIdentity(words).sign.publicKey));
  });

  it('rejects a wrong word or checksum', () => {
    expect(isValidRecoveryWords(`${'abandon '.repeat(23)}abandon`)).toBe(false);
    expect(() => recoveryIdentity('not even close')).toThrow();
  });
});

describe('pairing code', () => {
  it('is the same on both devices and changes with any key', () => {
    const a = newIdentity().sign.publicKey;
    const b = newIdentity().sign.publicKey;
    const secret = newSymmetricKey();
    const code = pairingCode(a, b, secret);
    expect(code).toMatch(/^\d{6}$/);
    expect(pairingCode(b, a, secret)).toBe(code);
    expect(pairingCode(a, newIdentity().sign.publicKey, secret)).not.toBe(code);
  });
});

describe('device log', () => {
  const device = () => ({ id: crypto.randomUUID(), keys: newIdentity() });
  const keysOf = (k: IdentityKeys) => ({ sign: k.sign.publicKey, box: k.box.publicKey });
  const T = 1_760_000_000_000;

  /** Appends on top of the verified log, like a client would. */
  const push = (log: DeviceLogEntry[], signer: { id: string; keys: IdentityKeys }, change: Parameters<typeof appendEntry>[3]) => [
    ...log,
    appendEntry(log.length ? verifyDeviceLog(log) : null, log.length, signer, change, T + log.length),
  ];

  const phoneA = device();
  const phoneB = device();
  const key1 = newSymmetricKey();
  const created = push([], phoneA, { type: 'create', deviceId: phoneA.id, keys: keysOf(phoneA.keys), familyKey: { epoch: 1, key: key1 } });

  it('tracks adds and removes', () => {
    let log = push(created, phoneA, { type: 'add', deviceId: phoneB.id, keys: keysOf(phoneB.keys) });
    expect([...verifyDeviceLog(log).members.keys()]).toEqual([phoneA.id, phoneB.id]);
    log = push(log, phoneB, { type: 'remove', deviceId: phoneA.id });
    expect([...verifyDeviceLog(log).members.keys()]).toEqual([phoneB.id]);
  });

  it('rejects entries signed by outsiders, reordered, dropped or edited', () => {
    const outsider = device();
    const forged = push(created, outsider, { type: 'add', deviceId: outsider.id, keys: keysOf(outsider.keys) });
    expect(() => verifyDeviceLog(forged)).toThrow('signer is not a member');

    const log = push(push(created, phoneA, { type: 'add', deviceId: phoneB.id, keys: keysOf(phoneB.keys) }), phoneA, {
      type: 'remove',
      deviceId: phoneB.id,
    });
    expect(() => verifyDeviceLog([log[0], log[2]])).toThrow();
    expect(() => verifyDeviceLog([log[0], log[2], log[1]])).toThrow();
    // A server swapping in its own keys for phone B breaks the signature.
    const swapped = { ...log[1], boxKey: toBase64(newIdentity().box.publicKey) };
    expect(() => verifyDeviceLog([log[0], swapped])).toThrow('bad signature');
  });

  it('never re-admits a removed device id', () => {
    let log = push(created, phoneA, { type: 'add', deviceId: phoneB.id, keys: keysOf(phoneB.keys) });
    log = push(log, phoneA, { type: 'remove', deviceId: phoneB.id });
    log = push(log, phoneA, { type: 'add', deviceId: phoneB.id, keys: keysOf(phoneB.keys) });
    expect(() => verifyDeviceLog(log)).toThrow('already used');
  });

  it('lets the recovery key add a device, but only once set and only adds', () => {
    const recovery = { id: RECOVERY_SIGNER, keys: recoveryIdentity(newRecoveryWords()) };
    const newPhone = device();
    const add = { type: 'add' as const, deviceId: newPhone.id, keys: keysOf(newPhone.keys) };
    expect(() => verifyDeviceLog(push(created, recovery, add))).toThrow('no recovery key');

    const withRecovery = push(created, phoneA, { type: 'setRecovery', deviceId: RECOVERY_SIGNER, keys: keysOf(recovery.keys) });
    expect(verifyDeviceLog(push(withRecovery, recovery, add)).members.has(newPhone.id)).toBe(true);
    expect(() => verifyDeviceLog(push(withRecovery, recovery, { type: 'remove', deviceId: phoneA.id }))).toThrow(
      'can only add',
    );
    const key2 = { epoch: 2, key: newSymmetricKey() };
    expect(() => verifyDeviceLog(push(withRecovery, recovery, { type: 'epoch', deviceId: RECOVERY_SIGNER, familyKey: key2 }))).toThrow('can only add');
  });

  it('commits to every family key, so a server-made key is refused', () => {
    expect(() => verifyDeviceLog(push([], phoneA, { type: 'create', deviceId: phoneA.id, keys: keysOf(phoneA.keys) }))).toThrow('must start epoch 1');

    const key2 = newSymmetricKey();
    const log = push(created, phoneA, { type: 'epoch', deviceId: phoneA.id, familyKey: { epoch: 2, key: key2 } });
    const state = verifyDeviceLog(log);
    expect(state.epoch).toBe(2);
    expect(openFamilyKey(phoneA.keys, state, 2, seal(phoneA.keys.box.publicKey, key2))).toEqual(key2);
    expect(openFamilyKey(phoneA.keys, state, 1, seal(phoneA.keys.box.publicKey, key1))).toEqual(key1);

    // The server knows phone A's public box key and seals its own key as epoch 2, or epoch 1's as 2, or a future epoch.
    const sealedTo = (k: Uint8Array) => seal(phoneA.keys.box.publicKey, k);
    expect(() => openFamilyKey(phoneA.keys, state, 2, sealedTo(newSymmetricKey()))).toThrow('not the one the family made');
    expect(() => openFamilyKey(phoneA.keys, state, 2, sealedTo(key1))).toThrow('not the one the family made');
    expect(() => openFamilyKey(phoneA.keys, state, 3, sealedTo(newSymmetricKey()))).toThrow('no key for epoch 3');

    // Epochs go up one at a time, are started by a member device, and carry a key only where they should.
    expect(() => verifyDeviceLog(push(created, phoneA, { type: 'epoch', deviceId: phoneA.id, familyKey: { epoch: 3, key: key2 } }))).toThrow('must start epoch 2');
    expect(() => verifyDeviceLog(push(created, phoneB, { type: 'epoch', deviceId: phoneB.id, familyKey: { epoch: 2, key: key2 } }))).toThrow('not a member');
    expect(() => verifyDeviceLog(push(created, phoneA, { type: 'add', deviceId: phoneB.id, keys: keysOf(phoneB.keys), familyKey: { epoch: 2, key: key2 } }))).toThrow(
      'only create and epoch',
    );
  });

  it('owes a rotation after a removal or a replaced recovery key, until the next epoch', () => {
    const recoveryKeys = (words = newRecoveryWords()) => keysOf(recoveryIdentity(words));
    let log = push(created, phoneA, { type: 'add', deviceId: phoneB.id, keys: keysOf(phoneB.keys) });
    expect(verifyDeviceLog(log).rotationDue).toBe(false);
    log = push(log, phoneA, { type: 'setRecovery', deviceId: RECOVERY_SIGNER, keys: recoveryKeys() });
    expect(verifyDeviceLog(log).rotationDue).toBe(false); // a first recovery key gets the keys anyway
    log = push(log, phoneA, { type: 'remove', deviceId: phoneB.id });
    expect(verifyDeviceLog(log).rotationDue).toBe(true);
    log = push(log, phoneA, { type: 'epoch', deviceId: phoneA.id, familyKey: { epoch: 2, key: newSymmetricKey() } });
    expect(verifyDeviceLog(log).rotationDue).toBe(false);
    log = push(log, phoneA, { type: 'setRecovery', deviceId: RECOVERY_SIGNER, keys: recoveryKeys() });
    expect(verifyDeviceLog(log).rotationDue).toBe(true); // the old words must not read what comes next
  });

  it('closes old epochs at a signed seq, so later records under an old key are refused', () => {
    let log = push(created, phoneA, { type: 'add', deviceId: phoneB.id, keys: keysOf(phoneB.keys) });
    log = push(log, phoneA, { type: 'remove', deviceId: phoneB.id });
    log = push(log, phoneA, { type: 'epoch', deviceId: phoneA.id, familyKey: { epoch: 2, key: newSymmetricKey() }, closedSeq: 40 });
    const state = verifyDeviceLog(log);
    expect(state.closedAt.get(1)).toBe(40);
    expect(withinEpoch(state, 1, 40)).toBe(true);
    // Phone B still has epoch 1's key; anything it writes after the rotation lands past seq 40.
    expect(withinEpoch(state, 1, 41)).toBe(false);
    expect(withinEpoch(state, 2, 1000)).toBe(true);

    // The seq is signed: a server changing it breaks the signature. It never goes back, and only epochs close.
    const tampered = log.map((e, i) => (i === log.length - 1 ? { ...e, closedSeq: 4000 } : e));
    expect(() => verifyDeviceLog(tampered)).toThrow('bad signature');
    const stripped = log.map((e, i) => (i === log.length - 1 ? { ...e, closedSeq: undefined } : e));
    expect(() => verifyDeviceLog(stripped)).toThrow('bad signature');
    expect(() => verifyDeviceLog(push(log, phoneA, { type: 'epoch', deviceId: phoneA.id, familyKey: { epoch: 3, key: newSymmetricKey() }, closedSeq: 39 }))).toThrow(
      'must not go back',
    );
    expect(() => verifyDeviceLog(push(log, phoneA, { type: 'remove', deviceId: phoneA.id, closedSeq: 50 }))).toThrow('only epoch entries');

    // An epoch started without one (an older app) closes nothing; the next one closes both.
    let legacy = push(created, phoneA, { type: 'epoch', deviceId: phoneA.id, familyKey: { epoch: 2, key: newSymmetricKey() } });
    expect(verifyDeviceLog(legacy).closedAt.size).toBe(0);
    legacy = push(legacy, phoneA, { type: 'epoch', deviceId: phoneA.id, familyKey: { epoch: 3, key: newSymmetricKey() }, closedSeq: 7 });
    expect([...verifyDeviceLog(legacy).closedAt]).toEqual([[1, 7], [2, 7]]);
  });

  it('notices a log rolled back to an older version', () => {
    const log = push(push(created, phoneA, { type: 'add', deviceId: phoneB.id, keys: keysOf(phoneB.keys) }), phoneA, { type: 'remove', deviceId: phoneB.id });
    const seen = { length: log.length, head: verifyDeviceLog(log).head };
    expect(() => assertLogContinues(log, seen)).not.toThrow();
    expect(() => assertLogContinues(push(log, phoneA, { type: 'epoch', deviceId: phoneA.id, familyKey: { epoch: 2, key: key1 } }), seen)).not.toThrow();
    expect(() => assertLogContinues(log.slice(0, 2), seen)).toThrow('older');
    // A different history of the same length (the server can't sign one, but a forked log must not pass either).
    const phoneC = device();
    const other = push(push(created, phoneA, { type: 'add', deviceId: phoneC.id, keys: keysOf(phoneC.keys) }), phoneA, { type: 'remove', deviceId: phoneC.id });
    expect(() => assertLogContinues(other, seen)).toThrow('older');
    expect(() => assertLogContinues(log, null)).not.toThrow();
  });
});

describe('file encryption', () => {
  const key = newSymmetricKey();

  it('round-trips empty, small and multi-chunk files', () => {
    for (const size of [0, 10, FILE_CHUNK, FILE_CHUNK * 2 + 5]) {
      const data = new Uint8Array(size).map((_, i) => i & 255);
      expect(decryptFile(key, encryptFile(key, data))).toEqual(data);
    }
  });

  it('detects truncation', () => {
    const box = encryptFile(key, new Uint8Array(FILE_CHUNK * 2 + 5));
    // Drop the last chunk: the new last chunk was not encrypted as "last".
    expect(() => decryptFile(key, box.subarray(0, 4 + 16 + FILE_CHUNK + 16))).toThrow();
  });
});

// Derived once from the zero-entropy words; must never change, or existing recovery keys stop working.
const SIGN_VECTOR = '1d5cfc1df788fb56134d66d69577b102085e334f0c16c1903ac14ccd61bc11a8';
const BOX_VECTOR = 'db681b557fa30bbc15ad52eea85575d4d062f1452fa4c36d4a6acc5cf304b821';

describe('u64', () => {
  it('encodes big-endian across the 32-bit boundary', async () => {
    const { u64 } = await import('../crypto');
    for (const n of [0, 1, 2 ** 32 - 1, 2 ** 32, 1_760_000_000_000, Number.MAX_SAFE_INTEGER]) {
      const view = new DataView(u64(n).buffer);
      expect(view.getBigUint64(0)).toBe(BigInt(n));
    }
  });
});

describe('utf8 fallback (no TextDecoder, as on Hermes)', () => {
  it('decodes like TextDecoder', async () => {
    const { bytesToUtf8, utf8ToBytes } = await import('../crypto');
    const original = globalThis.TextDecoder;
    const text = 'Sam · 120 ml · Brei 🥕 – ÄÖÜ ß 日本';
    try {
      // @ts-expect-error simulate an engine without TextDecoder
      delete globalThis.TextDecoder;
      expect(bytesToUtf8(utf8ToBytes(text))).toBe(text);
      expect(() => bytesToUtf8(new Uint8Array([0xc3]))).toThrow();
    } finally {
      globalThis.TextDecoder = original;
    }
  });
});

describe('encryptedFileSize', () => {
  it('matches encryptFile for every chunk boundary', async () => {
    const { encryptedFileSize } = await import('../crypto');
    const key = newSymmetricKey();
    for (const size of [0, 1, FILE_CHUNK - 1, FILE_CHUNK, FILE_CHUNK + 1, FILE_CHUNK * 3]) {
      expect(encryptFile(key, new Uint8Array(size)).length).toBe(encryptedFileSize(size));
    }
  });
});
