import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';
import { bytesToHex, hexToBytes, identityFromSeed, setRandomSource, type IdentityKeys } from '@kindred-log/shared/crypto';

// The shared crypto draws randomness from here; Hermes has no Web Crypto.
setRandomSource((length) => getRandomBytes(length));

const IDENTITY = 'kl.sync.identity';
const FAMILY_KEYS = 'kl.sync.familyKeys';
// Same policy as the database key (db/client.ts): readable after first unlock, in encrypted iOS backups.
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

/** This device's sync identity (signing + box key pairs), created on first use from a stored seed. */
export function deviceIdentity(): IdentityKeys {
  let seed = SecureStore.getItem(IDENTITY, OPTIONS);
  if (!seed) {
    seed = bytesToHex(getRandomBytes(32));
    SecureStore.setItem(IDENTITY, seed, OPTIONS);
  }
  return identityFromSeed(hexToBytes(seed));
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
