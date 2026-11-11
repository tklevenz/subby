import { t } from '@subby/shared/i18n';
import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { PRODUCTS, type EntitlementResponse, type ProductKind, type SyncAccess } from '@subby/shared/sync';
import { isHttpError, checkServer, type SyncSession } from './api';

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
};

export const useAccessStore = create<AccessState>(() => ({ entitlement: null, testPurchases: false, pretend: null, testTokens: [] }));

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

/** The price shown before the stores tell us theirs (and in their place in the test store). */
export const PRICE = '€6.99';

/** Whether buying works here: the test store, on a server that takes it; the real stores come with A3. */
export const canBuy = () => useAccessStore.getState().testPurchases;

/**
 * Buys `kind` (an unlock for this phone, or a slot gifted to the family) and tells the server, which checks it
 * with the store and answers with the new access.
 */
export async function buy(api: SyncSession, kind: ProductKind) {
  if (!canBuy()) throw new Error(t('sync.error.buyLater'));
  const token = `test-${Crypto.randomUUID()}`;
  const entitlement = await api.request<EntitlementResponse>('POST', '/v1/purchases', { store: 'test', product: PRODUCTS[kind], token });
  useAccessStore.setState((s) => ({ entitlement, testTokens: [...s.testTokens, { kind, token }] }));
  return entitlement;
}

/** Sends this store account's unlock again, so it moves to this phone (a new phone, or after re-joining). */
export async function restore(api: SyncSession) {
  if (!canBuy()) throw new Error(t('sync.error.restoreLater'));
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
