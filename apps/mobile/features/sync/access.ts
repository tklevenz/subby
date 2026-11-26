import { t } from '@subby/shared/i18n';
import { MINUTE_MS } from '@subby/shared';
import { useEffect } from 'react';
import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { AppState } from 'react-native';
import { PRODUCTS, type EntitlementResponse, type ProductKind, type SyncAccess, type UnlockInUseResponse } from '@subby/shared/sync';
import type { Purchase } from 'expo-iap';
import { isHttpError, checkServer, isOfficialServer, type SyncSession } from './api';
import { syncEvent } from './debugLog'; // TEMPORARY (A16)
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
    if (entitlement.access === 'free' || testPurchases) return;
    // Real store purchases belong to the official server only: a purchase token moves the unlock to whoever presents
    // it, so another server (misconfigured or hostile) must never see one.
    if (isOfficialServer(api.server)) startStoreCheck(api);
    else {
      useAccessStore.setState({ prices: {} }); // nothing to buy there (`useStoreUnavailable`)
      storeAsked = false; // asked again on the official server
    }
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
let storeAsked = false;
async function checkStore(api: SyncSession) {
  try {
    if (!storeAsked) {
      useAccessStore.setState({ prices: await storePrices() });
      storeAsked = true;
    }
    if (AppState.currentState !== 'active') return;
    for (const { purchase: p, kind } of await unsentPurchases(api.deviceId)) await send(api, p, kind);
  } catch (e) {
    storeFailedAt = Date.now();
    console.warn('Store check failed', e); // i18n-ignore
  }
}

/** After a failed store check, how long until the next one. */
const STORE_RETRY_MS = 10 * MINUTE_MS;
let storeCheck: Promise<void> | null = null;
let storeFailedAt: number | null = null;

/**
 * `checkStore` without waiting for it, one at a time. Play Billing that's missing or not answering takes ~30 s
 * per call (seen on an emulator); awaited, it held up every sync run, and joining waited for three of them.
 * After a failure it's left alone for `STORE_RETRY_MS`.
 */
function startStoreCheck(api: SyncSession) {
  if (storeCheck || (storeFailedAt !== null && Math.abs(Date.now() - storeFailedAt) < STORE_RETRY_MS)) return;
  storeCheck = checkStore(api).finally(() => {
    storeCheck = null;
  });
}

/**
 * Before sync is set up (or when moving to Subby Sync): the store's prices, so the price shown is in the account's
 * currency from the start. Once per app run, like `checkStore`; nothing on failure (no price is shown then).
 */
export async function ensurePrices() {
  if (storeAsked || useAccessStore.getState().prices) return;
  storeAsked = true;
  try {
    useAccessStore.setState({ prices: await storePrices() });
  } catch (e) {
    storeAsked = false;
    console.warn('Store prices failed', e); // i18n-ignore
  }
}

/** `usePrice`, asking the store first where sync isn't set up yet (the setup and move screens). */
export function useStorePrice(kind: ProductKind) {
  useEffect(() => {
    void ensurePrices();
  }, []);
  return usePrice(kind);
}

/** The test store's price (nothing is charged there). */
const TEST_PRICE = '€6.99';

/**
 * The price to show for `kind`: the store's, in the account's currency. Null until the store answers (or where it
 * can't sell): the screens then say it without a price, never a guess in another currency.
 */
export const usePrice = (kind: ProductKind): string | null => useAccessStore((s) => (s.testPurchases ? TEST_PRICE : (s.prices?.[kind] ?? null)));

/** Whether buying works here: the test store on a server that takes it, or a store that knows the product. */
export const canBuy = (kind: ProductKind = 'unlock') => {
  const { testPurchases, prices } = useAccessStore.getState();
  return testPurchases || Boolean(prices?.[kind]);
};

/**
 * `canBuy` for rendering: re-renders when the store's prices arrive. Reading `canBuy()` while rendering didn't:
 * the store's price was often the same text as the placeholder shown before it, so nothing else on the screen
 * changed and the buttons stayed disabled.
 */
export const useCanBuy = (kind: ProductKind = 'unlock') => useAccessStore((s) => s.testPurchases || Boolean(s.prices?.[kind]));

/** `canBuy`, and never the real store on another server than the official one (see `refreshEntitlement`). */
const canBuyOn = (api: SyncSession, kind: ProductKind = 'unlock') =>
  canBuy(kind) && (useAccessStore.getState().testPurchases || isOfficialServer(api.server));

/** Whether the store was asked and can't sell here (a build that didn't come from a store, no Play Store). */
export const useStoreUnavailable = () => useAccessStore((s) => !s.testPurchases && s.prices !== null && !s.prices.unlock);

/**
 * Hands a paid purchase to the server, which checks it with the store, then finishes it (StoreKit). A server that
 * can't be reached leaves it unsent: Android sends it again on the next sync run.
 */
function send(api: SyncSession, p: Purchase, kind: ProductKind, move = false): Promise<EntitlementResponse> {
  // Closing the store's sheet brings the app back to the foreground, which starts a sync run that finds the same
  // purchase still unfinished: one request per purchase, or Google answers the second's acknowledge/consume with 409.
  const key = p.purchaseToken!;
  let pending = sending.get(key);
  if (!pending) {
    pending = sendOnce(api, p, kind, move).finally(() => sending.delete(key));
    sending.set(key, pending);
  }
  return pending;
}
const sending = new Map<string, Promise<EntitlementResponse>>();

async function sendOnce(api: SyncSession, p: Purchase, kind: ProductKind, move: boolean) {
  let entitlement: EntitlementResponse;
  try {
    entitlement = await api.request<EntitlementResponse>('POST', '/v1/purchases', { store: storeName(), product: PRODUCTS[kind], token: p.purchaseToken!, ...(move ? { move } : {}) });
  } catch (e) {
    const taken = inUse(e);
    if (taken) {
      // The server has the purchase, so StoreKit may let it go, or it's sent again every run.
      await finish(p, kind).catch(() => {});
      throw taken;
    }
    if (isHttpError(e, 409) && /isn.t through/.test(e.message)) throw new PurchasePending(); // i18n-ignore
    // Refunded or cancelled (Google keeps a refunded unlock "owned" on the phone, so Restore still finds it).
    if (isHttpError(e, 403) && /cancelled|refunded/.test(e.message)) throw new Error(t('access.refunded')); // i18n-ignore
    if (!isHttpError(e) || e.status === 0 || e.status >= 500) throw new Error(t('access.sendLater'));
    throw e;
  }
  await finish(p, kind);
  useAccessStore.setState({ entitlement });
  return entitlement;
}

/**
 * This store account's unlock is used by another active phone: a partner sharing the Apple ID or Google account, or
 * this phone's own entry from before a reinstall. Nothing moved; `restore(api, { move: true })` takes it.
 * `deviceId`: that phone, if it's in this family.
 */
export class UnlockInUse extends Error {
  constructor(readonly deviceId: string | null) {
    super('This unlock is in use on another phone'); // i18n-ignore
  }
}

/** `UnlockInUse` for the server's answer that says so, else null. */
function inUse(e: unknown): UnlockInUse | null {
  if (!isHttpError(e, 409) || !e.body?.unlockInUse) return null;
  const body = e.body as Partial<UnlockInUseResponse>;
  return new UnlockInUse(typeof body.deviceId === 'string' ? body.deviceId : null);
}

/**
 * Buys `kind` (an unlock for this phone, or a slot gifted to the family) and tells the server, which checks it
 * with the store and answers with the new access.
 */
export async function buy(api: SyncSession, kind: ProductKind) {
  if (!canBuyOn(api, kind)) throw new Error(t('access.storeUnavailable'));
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

/**
 * Sends this store account's unlock again, so it moves to this phone (a new phone, or after re-joining). If another
 * active phone uses it, `UnlockInUse` unless `move` (asked first).
 */
export async function restore(api: SyncSession, { move = false } = {}) {
  if (!canBuyOn(api)) throw new Error(t('access.storeUnavailable'));
  if (!useAccessStore.getState().testPurchases) {
    const owned = await ownedUnlock();
    if (!owned) throw new Error(t('sync.error.noUnlock'));
    return send(api, owned, 'unlock', move);
  }
  const unlock = useAccessStore.getState().testTokens.findLast((t) => t.kind === 'unlock');
  if (!unlock) throw new Error(t('sync.error.noUnlock'));
  let entitlement: EntitlementResponse;
  try {
    entitlement = await api.request<EntitlementResponse>('POST', '/v1/purchases', { store: 'test', product: PRODUCTS.unlock, token: unlock.token, ...(move ? { move } : {}) });
  } catch (e) {
    throw inUse(e) ?? e;
  }
  useAccessStore.setState({ entitlement });
  return entitlement;
}

/**
 * After joining, and when the Sync screen opens on a phone without an unlock: if this store account already has an
 * unlock that no other phone in use holds, it moves here without asking. In use elsewhere (a partner sharing the
 * account, or this phone before a reinstall): the `UnlockInUse`, and the Sync screen asks once per holder. Offline,
 * refunded or no store: nothing.
 */
export async function restoreQuietly(api: SyncSession): Promise<'moved' | UnlockInUse | null> {
  try {
    const { testPurchases, entitlement } = useAccessStore.getState();
    // Background runs don't open the billing connection.
    if (AppState.currentState !== 'active' || testPurchases || !canBuyOn(api) || !entitlement || entitlement.access === 'free' || entitlement.access === 'unlock') return null;
    const owned = await ownedUnlock({ quiet: true });
    syncEvent(`quiet restore: ${owned ? 'unlock found' : 'no unlock'}`); // TEMPORARY (A16)
    if (!owned) return null;
    await send(api, owned, 'unlock');
    return 'moved';
  } catch (e) {
    syncEvent(`quiet restore: ${e instanceof UnlockInUse ? 'in use' : 'failed'}`); // TEMPORARY (A16)
    // In use elsewhere: the caller may ask (the Sync screen does). Refunded, offline, no store: nothing.
    return e instanceof UnlockInUse ? e : null;
  }
}

/** On a test-store server: refunds the last test purchase, to see what a refund does. */
export async function refundLastTest(api: SyncSession) {
  const last = useAccessStore.getState().testTokens.at(-1);
  if (!last) throw new Error(t('sync.error.noTestPurchase'));
  const entitlement = await api.request<EntitlementResponse>('POST', '/v1/purchases/test/refund', { token: last.token });
  useAccessStore.setState((s) => ({ entitlement, testTokens: s.testTokens.slice(0, -1) }));
  return entitlement;
}
