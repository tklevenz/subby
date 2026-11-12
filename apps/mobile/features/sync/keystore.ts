import { t } from '@subby/shared/i18n';
import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';
import { bytesToHex, hexToBytes, identityFromSeed, setRandomSource, type IdentityKeys } from '@subby/shared/crypto';

// The shared crypto draws randomness from here; Hermes has no Web Crypto.
setRandomSource((length) => getRandomBytes(length));

const IDENTITY = 'kl.sync.identity';
const FAMILY_KEYS = 'kl.sync.familyKeys';
// Readable after first unlock (background sync), and never in an iOS backup or on another phone: a restored
// backup brings the data (the database key is in encrypted backups), but this phone's place in the family stays
// here, so two phones can't share one identity. Android keeps SecureStore out of its backups anyway.
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

/**
 * Sync is set up, but this phone's identity is gone (restored from a backup or moved to a new phone, or the
 * keychain was cleared). The family can't be reached with it any more: this phone joins again.
 */
export class IdentityLostError extends Error {
  constructor() {
    super(t('sync.error.identityLost'));
    this.name = 'IdentityLostError';
  }
}

export const hasDeviceIdentity = () => SecureStore.getItem(IDENTITY, OPTIONS) !== null;

/** This device's sync identity (signing + box key pairs). Never made up here: a missing one is lost. */
export function deviceIdentity(): IdentityKeys {
  const seed = SecureStore.getItem(IDENTITY, OPTIONS);
  if (!seed) throw new IdentityLostError();
  return identityFromSeed(hexToBytes(seed));
}

/** The identity to start or join a family with: this phone's, or a new one. */
export function ensureDeviceIdentity(): IdentityKeys {
  if (!hasDeviceIdentity()) SecureStore.setItem(IDENTITY, bytesToHex(getRandomBytes(32)), OPTIONS);
  return deviceIdentity();
}

/** Family keys by epoch. Every epoch is kept so older records stay readable. */
export function loadFamilyKeys(): Map<number, Uint8Array> {
  const raw = SecureStore.getItem(FAMILY_KEYS, OPTIONS);
  const entries = raw ? (JSON.parse(raw) as [number, string][]) : [];
  return new Map(entries.map(([epoch, hex]) => [epoch, hexToBytes(hex)]));
}

export function saveFamilyKeys(keys: ReadonlyMap<number, Uint8Array>) {
  SecureStore.setItem(FAMILY_KEYS, JSON.stringify([...keys].map(([epoch, key]) => [epoch, bytesToHex(key)])), OPTIONS);
}

/** Forgets this device's sync secrets (leaving sync). A new identity is made on the next setup. */
export async function clearSyncSecrets() {
  await SecureStore.deleteItemAsync(FAMILY_KEYS, OPTIONS);
  await SecureStore.deleteItemAsync(IDENTITY, OPTIONS);
}
