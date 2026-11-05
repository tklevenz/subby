import { X509Certificate, verify as verifySignature } from 'node:crypto';
import type { ProductKind } from '@kindred-log/shared/sync';
import type { AppStoreConfig, GooglePlayConfig } from '../config';
import { GoogleAuth } from '../common/google';
import { sha256b64 } from '../common/hash';

/** A purchase the store confirmed. */
export type VerifiedPurchase = {
  /** Our purchase id: stable for the same purchase (a restore of an unlock finds the same row). */
  id: string;
  /** The device id the app put into the purchase (Google `obfuscatedAccountId`, Apple `appAccountToken`), if any. */
  accountId: string | null;
};

/** The store says no: not bought, cancelled, refunded, or not for this app. */
export class PurchaseRefused extends Error {}
/** Google: paid with a slow method (e.g. cash at a shop); try again once it's through. */
export class PurchasePending extends Error {}

export interface Store {
  verify(product: string, token: string): Promise<VerifiedPurchase>;
  /** After the purchase is stored: Google needs unlocks acknowledged (or it refunds them) and slots consumed (so they can be bought again). */
  finish(product: string, token: string, kind: ProductKind): Promise<void>;
}

// --- Google Play ------------------------------------------------------------------------------------------

type ProductPurchase = {
  /** 0 purchased, 1 cancelled, 2 pending. */
  purchaseState?: number;
  /** 0 not yet consumed, 1 consumed. */
  consumptionState?: number;
  /** 0 not yet acknowledged, 1 acknowledged. */
  acknowledgementState?: number;
  obfuscatedExternalAccountId?: string;
};

export const googlePurchaseId = (token: string) => `google:${sha256b64(token)}`;

/** The Android Publisher API (`purchases.products`, `voidedpurchases`). */
export class GooglePlay implements Store {
  private readonly auth: GoogleAuth;

  constructor(private readonly config: GooglePlayConfig) {
    this.auth = new GoogleAuth(config, 'https://www.googleapis.com/auth/androidpublisher');
  }

  private url(product: string, token: string, action = '') {
    const { apiUrl, packageName } = this.config;
    return `${apiUrl}/applications/${encodeURIComponent(packageName)}/purchases/products/${encodeURIComponent(product)}/tokens/${encodeURIComponent(token)}${action}`;
  }

  private async call(url: string, method = 'GET') {
    const res = await fetch(url, { method, headers: { authorization: `Bearer ${await this.auth.token()}` } });
    // Unknown token, or one for another app or product.
    if (res.status === 400 || res.status === 404 || res.status === 410) throw new PurchaseRefused('Google Play doesn’t know this purchase');
    if (!res.ok) throw new Error(`Google Play answered ${res.status}: ${await res.text().catch(() => '')}`);
    return res;
  }

  async verify(product: string, token: string): Promise<VerifiedPurchase> {
    const purchase = (await (await this.call(this.url(product, token))).json()) as ProductPurchase;
    if (purchase.purchaseState === 2) throw new PurchasePending('The payment isn’t through yet');
    if (purchase.purchaseState !== 0) throw new PurchaseRefused('This purchase was cancelled');
    return { id: googlePurchaseId(token), accountId: purchase.obfuscatedExternalAccountId ?? null };
  }

  async finish(product: string, token: string, kind: ProductKind) {
    const purchase = (await (await this.call(this.url(product, token))).json()) as ProductPurchase;
    if (kind === 'slot' && purchase.consumptionState === 0) await this.call(this.url(product, token, ':consume'), 'POST');
    if (kind === 'unlock' && purchase.acknowledgementState === 0) await this.call(this.url(product, token, ':acknowledge'), 'POST');
  }

  /** Purchases refunded or charged back since `since` (ms, at most 30 days back), as our purchase ids. */
  async voidedSince(since: number): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ startTime: String(since), maxResults: '1000', ...(pageToken ? { token: pageToken } : {}) });
      const res = await this.call(`${this.config.apiUrl}/applications/${encodeURIComponent(this.config.packageName)}/purchases/voidedpurchases?${query}`);
      const page = (await res.json()) as { voidedPurchases?: { purchaseToken: string }[]; tokenPagination?: { nextPageToken?: string } };
      ids.push(...(page.voidedPurchases ?? []).map((v) => googlePurchaseId(v.purchaseToken)));
      pageToken = page.tokenPagination?.nextPageToken;
    } while (pageToken);
    return ids;
  }
}

// --- Test store -----------------------------------------------------------------------------------------

/** TEST_PURCHASES=1 only: accepts any well-formed token the app made up, so the unlock screens can be tried end to end. */
export class TestStore implements Store {
  async verify(_product: string, token: string): Promise<VerifiedPurchase> {
    if (!/^test-[A-Za-z0-9-]{8,100}$/.test(token)) throw new PurchaseRefused('Not a test purchase');
    return { id: testPurchaseId(token), accountId: null };
  }

  async finish() {}
}

export const testPurchaseId = (token: string) => `test:${sha256b64(token)}`;

// --- App Store --------------------------------------------------------------------------------------------

/** Marker extensions Apple puts in its StoreKit signing certificates (by their DER-encoded OIDs). */
const OID_DER = (oid: number[]) => Buffer.from([0x06, oid.length, ...oid]);
// 1.2.840.113635.100.6.11.1: the App Store receipt signing leaf.
const LEAF_OID = OID_DER([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x06, 0x0b, 0x01]);
// 1.2.840.113635.100.6.2.1: the WWDR intermediate.
const INTERMEDIATE_OID = OID_DER([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x06, 0x02, 0x01]);

/**
 * Verifies an Apple-signed JWS (a StoreKit 2 transaction, or a server notification): ES256, its x5c chain
 * leaf → intermediate → one of `roots`, each certificate valid now and carrying Apple's marker. Returns the payload.
 */
export function verifyAppleJws<T>(jws: string, roots: string[], now = new Date()): T {
  const parts = jws.split('.');
  if (parts.length !== 3) throw new PurchaseRefused('Not a signed transaction');
  const [head, body, sig] = parts as [string, string, string];
  let header: { alg?: string; x5c?: string[] };
  try {
    header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8')) as typeof header;
  } catch {
    throw new PurchaseRefused('Not a signed transaction');
  }
  if (header.alg !== 'ES256' || !Array.isArray(header.x5c) || header.x5c.length !== 3) throw new PurchaseRefused('Unexpected signature');
  const [leaf, intermediate, root] = header.x5c.map((c) => new X509Certificate(Buffer.from(c, 'base64')));
  const trusted = roots.map((pem) => new X509Certificate(pem));
  if (!trusted.some((t) => t.raw.equals(root!.raw))) throw new PurchaseRefused('Not signed by Apple');
  const valid = (c: X509Certificate) => new Date(c.validFrom) <= now && now <= new Date(c.validTo);
  if (![leaf!, intermediate!, root!].every(valid)) throw new PurchaseRefused('Expired certificate');
  if (!intermediate!.ca || leaf!.ca) throw new PurchaseRefused('Bad certificate chain');
  if (!leaf!.checkIssued(intermediate!) || !leaf!.verify(intermediate!.publicKey)) throw new PurchaseRefused('Bad certificate chain');
  if (!intermediate!.checkIssued(root!) || !intermediate!.verify(root!.publicKey)) throw new PurchaseRefused('Bad certificate chain');
  if (!leaf!.raw.includes(LEAF_OID) || !intermediate!.raw.includes(INTERMEDIATE_OID)) throw new PurchaseRefused('Not a StoreKit certificate');
  const ok = verifySignature('sha256', Buffer.from(`${head}.${body}`), { key: leaf!.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  if (!ok) throw new PurchaseRefused('Bad signature');
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
}

/** The decoded StoreKit 2 transaction (JWSTransactionDecodedPayload), as far as we use it. */
type AppleTransaction = {
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  environment: 'Production' | 'Sandbox' | string;
  appAccountToken?: string;
  revocationDate?: number;
};

type AppleNotification = {
  notificationType: string;
  data?: { bundleId?: string; environment?: string; signedTransactionInfo?: string };
};

export const applePurchaseId = (originalTransactionId: string) => `apple:${originalTransactionId}`;

/** StoreKit 2: the app sends the transaction's `jwsRepresentation`; it's checked offline, no API call needed. */
export class AppStore implements Store {
  constructor(private readonly config: AppStoreConfig) {}

  private transaction(jws: string): AppleTransaction {
    const t = verifyAppleJws<AppleTransaction>(jws, this.config.roots);
    if (t.bundleId !== this.config.bundleId) throw new PurchaseRefused('This purchase is for another app');
    if (t.environment !== 'Production' && !this.config.allowSandbox) throw new PurchaseRefused('Test purchases aren’t accepted here');
    return t;
  }

  async verify(product: string, jws: string): Promise<VerifiedPurchase> {
    const t = this.transaction(jws);
    if (t.productId !== product) throw new PurchaseRefused('This purchase is for another product');
    if (t.revocationDate) throw new PurchaseRefused('This purchase was refunded');
    return { id: applePurchaseId(t.originalTransactionId), accountId: t.appAccountToken?.toLowerCase() ?? null };
  }

  /** StoreKit consumes and finishes on the phone. */
  async finish() {}

  /**
   * An App Store Server Notification (V2): which purchase it changes, if it's a refund or revocation (or a
   * reversed refund). Null for every other kind.
   */
  notification(signedPayload: string): { id: string; revoked: boolean } | null {
    const n = verifyAppleJws<AppleNotification>(signedPayload, this.config.roots);
    const revoked = n.notificationType === 'REFUND' || n.notificationType === 'REVOKE' ? true : n.notificationType === 'REFUND_REVERSED' ? false : null;
    if (revoked === null || !n.data?.signedTransactionInfo) return null;
    const t = this.transaction(n.data.signedTransactionInfo);
    return { id: applePurchaseId(t.originalTransactionId), revoked };
  }
}
