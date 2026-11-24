import { Platform } from 'react-native';
import { t } from '@subby/shared/i18n';
import { PRODUCTS, productKind, type ProductKind } from '@subby/shared/sync';
import type * as ExpoIap from 'expo-iap';
import type { Purchase, PurchaseAndroid } from 'expo-iap';
import { optionalModule } from '../optionalModule';

/**
 * Google Play and the App Store, through expo-iap (LAUNCH.md A3). The server checks every purchase with the store
 * and, on Google, acknowledges (unlock) or consumes (slot) it itself; StoreKit purchases are finished here, after
 * the server took them. Not in Expo Go. (Sideloaded and Xcode builds buy with test accounts: Play license testers,
 * App Store sandbox.)
 */
let module: typeof ExpoIap | null | undefined;
const iap = () => (module === undefined ? (module = optionalModule(() => require('expo-iap') as typeof ExpoIap, 'expo-go')) : module);

export const storeName = (): 'google' | 'apple' => (Platform.OS === 'ios' ? 'apple' : 'google');

/** The person closed the store's sheet: nothing to report. */
export class PurchaseCancelled extends Error {}

/** Paid with something that settles later (cash at a shop, a bank transfer): the purchase is sent once it's through. */
export class PurchasePending extends Error {
  constructor() {
    super(t('access.pending'));
  }
}

/** The account already has this phone's unlock (bought before, or on another phone): restore it instead. */
export class AlreadyOwned extends Error {}

let connecting: Promise<boolean> | null = null;
function connect(): Promise<boolean> {
  const m = iap();
  if (!m) return Promise.resolve(false);
  // A failed connection (no Play Store, a sideloaded build) is tried again next time.
  connecting ??= m.initConnection().then(Boolean, () => {
    connecting = null;
    return false;
  });
  return connecting;
}

/** The store's prices for our products, in the account's currency. Empty where buying doesn't work. */
export async function storePrices(): Promise<Partial<Record<ProductKind, string>>> {
  if (!(await connect())) return {};
  const products = (await iap()!.fetchProducts({ skus: Object.values(PRODUCTS), type: 'in-app' })) as { id: string; displayPrice: string }[] | null;
  const prices: Partial<Record<ProductKind, string>> = {};
  for (const p of products ?? []) {
    const kind = productKind(p.id);
    if (kind) prices[kind] = p.displayPrice;
  }
  return prices;
}

/**
 * Opens the store's purchase sheet for `kind` and waits for the outcome. The device id goes into the purchase
 * (Google's obfuscated account id, Apple's app account token: both take a UUID), so the server can tell that a
 * gifted slot was bought on this phone.
 */
export async function purchase(kind: ProductKind, deviceId: string): Promise<Purchase> {
  if (!(await connect())) throw new Error(t('access.storeUnavailable'));
  const m = iap()!;
  const sku = PRODUCTS[kind];
  return new Promise<Purchase>((resolve, reject) => {
    const done = () => {
      updated.remove();
      failed.remove();
    };
    const updated = m.purchaseUpdatedListener((p) => {
      if (p.productId !== sku) return;
      done();
      if (p.purchaseState === 'pending') reject(new PurchasePending());
      else if (!p.purchaseToken) reject(new Error(t('access.storeUnavailable')));
      else resolve(p);
    });
    const failed = m.purchaseErrorListener((e) => {
      done();
      if (e.code === m.ErrorCode.UserCancelled) reject(new PurchaseCancelled());
      else if (e.code === m.ErrorCode.Pending || e.code === m.ErrorCode.DeferredPayment) reject(new PurchasePending());
      else if (e.code === m.ErrorCode.AlreadyOwned) reject(new AlreadyOwned());
      else reject(new Error(e.message));
    });
    m.requestPurchase({
      type: 'in-app',
      request: { google: { skus: [sku], obfuscatedAccountId: deviceId }, apple: { sku, appAccountToken: deviceId } },
    }).catch((e: unknown) => {
      done();
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}

/** After the server took it: StoreKit needs the transaction finished on the phone (Google's is done by the server). */
export async function finish(p: Purchase, kind: ProductKind) {
  if (Platform.OS === 'ios') await iap()!.finishTransaction({ purchase: p, isConsumable: kind === 'slot' });
}

/** This store account's unlock, if it has one (for Restore). */
export async function ownedUnlock(): Promise<Purchase | undefined> {
  if (!(await connect())) throw new Error(t('access.storeUnavailable'));
  const m = iap()!;
  await m.restorePurchases().catch(() => {});
  const owned = await m.getAvailablePurchases();
  return owned.find((p) => p.productId === PRODUCTS.unlock && p.purchaseState === 'purchased' && p.purchaseToken);
}

/**
 * Purchases that were paid but never reached the server (the app closed, or the network dropped, in between), so
 * each sync run sends them.
 * - Android: an unlock not yet acknowledged, or a slot bought on this phone and not yet consumed (Google refunds
 *   them after three days). An acknowledged unlock is left alone: sending it would move it here from whichever
 *   phone uses it now.
 * - iOS: StoreKit's unfinished transactions bought on this phone (its app account token). The queue belongs to
 *   the Apple account, so another phone's unfinished unlock stays with that phone.
 */
export async function unsentPurchases(deviceId: string): Promise<{ purchase: Purchase; kind: ProductKind }[]> {
  if (!(await connect())) return [];
  const unsent: { purchase: Purchase; kind: ProductKind }[] = [];
  if (Platform.OS === 'ios') {
    for (const p of await iap()!.getPendingTransactionsIOS()) {
      const kind = productKind(p.productId);
      if (kind && p.purchaseToken && p.appAccountToken?.toLowerCase() === deviceId.toLowerCase()) unsent.push({ purchase: p, kind });
    }
    return unsent;
  }
  const owned = await iap()!.getAvailablePurchases();
  for (const p of owned as PurchaseAndroid[]) {
    if (p.purchaseState !== 'purchased' || !p.purchaseToken) continue;
    if (p.productId === PRODUCTS.unlock && !p.isAcknowledgedAndroid) unsent.push({ purchase: p, kind: 'unlock' });
    if (p.productId === PRODUCTS.slot && p.obfuscatedAccountIdAndroid === deviceId) unsent.push({ purchase: p, kind: 'slot' });
  }
  return unsent;
}
