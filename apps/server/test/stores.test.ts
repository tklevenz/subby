import { describe, expect, it } from 'vitest';
import { AppStore, PurchaseRefused, verifyAppleJws } from '../src/purchases/stores';
import { APPLE_ROOT_CA_G3 } from '../src/purchases/appleRoot';
import { appleTestSigner } from './appleCerts';

const apple = appleTestSigner();
const transaction = (over: object = {}) => ({
  originalTransactionId: '2000000123',
  bundleId: 'baby.subby.app',
  productId: 'sync_unlock',
  environment: 'Production',
  appAccountToken: '0190F6A2-7C1B-7000-8000-000000000001',
  ...over,
});
const store = (allowSandbox = false) => new AppStore({ bundleId: 'baby.subby.app', roots: [apple.rootPem], allowSandbox });

describe('App Store signatures', () => {
  it('accepts a transaction signed through the trusted root', () => {
    expect(verifyAppleJws(apple.sign({ a: 1 }), [apple.rootPem])).toEqual({ a: 1 });
  });

  it('refuses another root, a changed payload, and certificates without Apple’s markers', () => {
    expect(() => verifyAppleJws(apple.sign({ a: 1 }), [APPLE_ROOT_CA_G3])).toThrow(PurchaseRefused);
    const [h, , s] = apple.sign({ a: 1 }).split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ a: 2 })).toString('base64url')}.${s}`;
    expect(() => verifyAppleJws(forged, [apple.rootPem])).toThrow('Bad signature');
    const plain = appleTestSigner({ markers: false });
    expect(() => verifyAppleJws(plain.sign({ a: 1 }), [plain.rootPem])).toThrow('Not a StoreKit certificate');
    expect(() => verifyAppleJws('garbage', [apple.rootPem])).toThrow(PurchaseRefused);
  });

  it('refuses anything that doesn’t parse, rather than failing (a 500 anyone could cause)', () => {
    const b64 = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
    const [, body, sig] = apple.sign({ a: 1 }).split('.');
    const x5c = JSON.parse(Buffer.from(apple.sign({}).split('.')[0]!, 'base64url').toString()).x5c as string[];
    for (const header of [null, 1, 'text', [], { alg: 'ES256', x5c: [1, 2, 3] }, { alg: 'ES256', x5c: [{}, {}, {}] }, { alg: 'ES256', x5c: ['AAAA', 'AAAA', 'AAAA'] }, { alg: 'ES256', x5c: [x5c[0], 'not a cert!', x5c[2]] }]) {
      expect(() => verifyAppleJws(`${b64(header)}.${body}.${sig}`, [apple.rootPem]), JSON.stringify(header)).toThrow(PurchaseRefused);
    }
    expect(() => verifyAppleJws(`${b64('{not json')}.${body}.${sig}`, [apple.rootPem])).toThrow(PurchaseRefused);
    expect(() => verifyAppleJws(`..`, [apple.rootPem])).toThrow(PurchaseRefused);
    // Signed, but the payload isn't an object.
    expect(() => verifyAppleJws(apple.sign(5 as unknown as object), [apple.rootPem])).toThrow(PurchaseRefused);
  });

  it('refuses certificates outside their validity', () => {
    expect(() => verifyAppleJws(apple.sign({}), [apple.rootPem], new Date(Date.now() + 365 * 86_400_000))).toThrow('Expired certificate');
  });

  it('checks the app, product, environment and refunds', async () => {
    await expect(store().verify('sync_unlock', apple.sign(transaction()))).resolves.toEqual({
      id: 'apple:2000000123',
      accountId: '0190f6a2-7c1b-7000-8000-000000000001',
    });
    await expect(store().verify('sync_slot', apple.sign(transaction()))).rejects.toThrow('another product');
    await expect(store().verify('sync_unlock', apple.sign(transaction({ bundleId: 'com.other' })))).rejects.toThrow('another app');
    await expect(store().verify('sync_unlock', apple.sign(transaction({ environment: 'Sandbox' })))).rejects.toThrow('Test purchases');
    await expect(store(true).verify('sync_unlock', apple.sign(transaction({ environment: 'Sandbox' })))).resolves.toBeTruthy();
    await expect(store().verify('sync_unlock', apple.sign(transaction({ revocationDate: 1 })))).rejects.toThrow('refunded');
  });

  it('reads refunds and reversals from server notifications', () => {
    const note = (notificationType: string) => apple.sign({ notificationType, data: { signedTransactionInfo: apple.sign(transaction()) } });
    expect(store().notification(note('REFUND'))).toEqual({ id: 'apple:2000000123', revoked: true });
    expect(store().notification(note('REVOKE'))).toEqual({ id: 'apple:2000000123', revoked: true });
    expect(store().notification(note('REFUND_REVERSED'))).toEqual({ id: 'apple:2000000123', revoked: false });
    expect(store().notification(note('CONSUMPTION_REQUEST'))).toBeNull();
  });
});
