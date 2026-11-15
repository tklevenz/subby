import { t } from '@subby/shared/i18n';
import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { AppState } from 'react-native';
import { PRODUCTS, type EntitlementResponse, type ProductKind, type SyncAccess } from '@subby/shared/sync';
import type { Purchase } from 'expo-iap';
import { isHttpError, checkServer, type SyncSession } from './api';
import { AlreadyOwned, PurchasePending, finish, ownedUnlock, purchase, storeName, storePrices, unsentPurchases } from './store';

/**
 * Whether this phone may write to the family on the server (PROJECT.md §3), for the unlock screens and the engine.
 * Self-hosted servers answer `free`. Reading never needs an unlock, only sharing what this phone logs.
 */
type AccessState = {
  entitlement: EntitlementResponse | null;
  /**
   * The server takes the pretend store (TEST_PURCHASES=1, never on the official server); the app then buys through
   * it, release builds too, so the whole flow can be tried on phones without paying.
   */
  testPurchases: boolean;
  /** Dev tools (dev builds, or a test-store server): pretend to be in this state, to look at the screens. */
  pretend: SyncAccess | null;
  /** Test-store tokens bought in this session, so one can be refunded again. */
  testTokens: { kind: ProductKind; token: string }[];
  /** The real store's prices, in the account's currency, once asked (`null`: not yet). Empty where buying doesn't work. */
  prices: Partial<Record<ProductKind, string>> | null;
};

export const useAccessStore = create<AccessState>(() => ({ entitlement: null, testPurchases: false, pretend: null, testTokens: [], prices: null }));

/** The access the screens show: the dev pretend state, else the server's answer (null until known). */
export function useAccess(): SyncAccess | null {
  return useAccessStore((s) => s.pretend || s.entitlement?.access || null);
}

/** Whether to show the dev tools: dev builds, or a server with the test store. */
export const useDevTools = () => useAccessStore((s) => __DEV__ || s.testPurchases);

/** Whether this phone's writes reach the family. Unknown counts as yes, so a server hiccup doesn't stop pushing. */
export const canWrite = () => useAccessStore.getState().entitlement?.access !== 'readOnly';

/** Each sync run: reads this phone's access. An older server without payments is `free`. */
export async function refreshEntitlement(api: SyncSession) {
  try {
    const entitlement = await api.request<EntitlementResponse>('GET', '/v1/entitlement');
    const testPurchases = entitlement.access !== 'free' ? Boolean((await checkServer(api.server)).testPurchases) : false;
    useAccessStore.setState({ entitlement, testPurchases });
    if (entitlement.access !== 'free' && !testPurchases) await checkStore(api);
  } catch (e) {
    if (isHttpError(e, 404)) {
      useAccessStore.setState({ entitlement: FREE, testPurchases: false });
      return;
    }
    throw e;
  }
}

const FREE: EntitlementResponse = { access: 'free', trialEndsAt: null, graceEndsAt: null, slots: 0, freeSlots: 0, devices: [], photoBytes: 0, photoLimit: null };

export function forgetAccess() {
  useAccessStore.setState({ entitlement: null, testPurchases: false, pretend: null, testTokens: [] });
}

/**
 * Hosted, with the real store: its prices (once per app run), and purchases paid for but never sent (each run, in
 * the foreground only: background runs don't open the billing connection). Never fails the run.
 */
async function checkStore(api: SyncSession) {
  try {
    if (useAccessStore.getState().prices === null) useAccessStore.setState({ prices: await storePrices() });
    if (AppState.currentState !== 'active') return;
    for (const { purchase: p, kind } of await unsentPurchases(api.deviceId)) await send(api, p, kind);
  } catch (e) {
    console.warn('Store check failed', e); // i18n-ignore
  }
}

/** The price shown before the stores tell us theirs (and in their place in the test store). */
export const PRICE = '€6.99';

/** The price to show for `kind`: the store's, in the account's currency, else ours. */
export const usePrice = (kind: ProductKind) => useAccessStore((s) => (s.testPurchases ? PRICE : (s.prices?.[kind] ?? PRICE)));

/** Whether buying works here: the test store on a server that takes it, or a store that knows the product. */
export const canBuy = (kind: ProductKind = 'unlock') => {
  const { testPurchases, prices } = useAccessStore.getState();
  return testPurchases || Boolean(prices?.[kind]);
};

/** Whether the store was asked and can't sell here (a build that didn't come from a store, no Play Store). */
export const useStoreUnavailable = () => useAccessStore((s) => !s.testPurchases && s.prices !== null && !s.prices.unlock);

/**
 * Hands a paid purchase to the server, which checks it with the store, then finishes it (StoreKit). A server that
 * can't be reached leaves it unsent: Android sends it again on the next sync run.
 */
async function send(api: SyncSession, p: Purchase, kind: ProductKind) {
  let entitlement: EntitlementResponse;
  try {
    entitlement = await api.request<EntitlementResponse>('POST', '/v1/purchases', { store: storeName(), product: PRODUCTS[kind], token: p.purchaseToken! });
  } catch (e) {
    if (isHttpError(e, 409) && /isn.t through/.test(e.message)) throw new PurchasePending(); // i18n-ignore
    if (!isHttpError(e) || e.status === 0 || e.status >= 500) throw new Error(t('access.sendLater'));
    throw e;
  }
  await finish(p, kind);
  useAccessStore.setState({ entitlement });
  return entitlement;
}

/**
 * Buys `kind` (an unlock for this phone, or a slot gifted to the family) and tells the server, which checks it
 * with the store and answers with the new access.
 */
export async function buy(api: SyncSession, kind: ProductKind) {
  if (!canBuy(kind)) throw new Error(t('access.storeUnavailable'));
  if (!useAccessStore.getState().testPurchases) {
    try {
      return await send(api, await purchase(kind, api.deviceId), kind);
    } catch (e) {
      // The account bought its unlock before (another phone, an earlier install): move it here instead.
      if (e instanceof AlreadyOwned) return restore(api);
      throw e;
    }
  }
  const token = `test-${Crypto.randomUUID()}`;
  const entitlement = await api.request<EntitlementResponse>('POST', '/v1/purchases', { store: 'test', product: PRODUCTS[kind], token });
  useAccessStore.setState((s) => ({ entitlement, testTokens: [...s.testTokens, { kind, token }] }));
  return entitlement;
}

/** Sends this store account's unlock again, so it moves to this phone (a new phone, or after re-joining). */
export async function restore(api: SyncSession) {
  if (!canBuy()) throw new Error(t('access.storeUnavailable'));
  if (!useAccessStore.getState().testPurchases) {
    const owned = await ownedUnlock();
    if (!owned) throw new Error(t('sync.error.noUnlock'));
    return send(api, owned, 'unlock');
  }
  const unlock = useAccessStore.getState().testTokens.findLast((t) => t.kind === 'unlock');
  if (!unlock) throw new Error(t('sync.error.noUnlock'));
  const entitlement = await api.request<EntitlementResponse>('POST', '/v1/purchases', { store: 'test', product: PRODUCTS.unlock, token: unlock.token });
  useAccessStore.setState({ entitlement });
  return entitlement;
}

/** On a test-store server: refunds the last test purchase, to see what a refund does. */
export async function refundLastTest(api: SyncSession) {
  const last = useAccessStore.getState().testTokens.at(-1);
  if (!last) throw new Error(t('sync.error.noTestPurchase'));
  const entitlement = await api.request<EntitlementResponse>('POST', '/v1/purchases/test/refund', { token: last.token });
  useAccessStore.setState((s) => ({ entitlement, testTokens: s.testTokens.slice(0, -1) }));
  return entitlement;
}
