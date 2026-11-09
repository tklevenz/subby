type RandomSource = (length: number) => Uint8Array;

/** Web Crypto, available on Node and browsers. React Native injects `expo-crypto` via `setRandomSource`. */
const webCrypto: RandomSource = (length) => {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (!c?.getRandomValues) throw new Error('No secure random source: call setRandomSource() at startup');
  return c.getRandomValues(new Uint8Array(length));
};

let source: RandomSource = webCrypto;

/** Install the platform's CSPRNG. Never pass a non-cryptographic source (Math.random) outside tests. */
export function setRandomSource(next: RandomSource): void {
  source = next;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = source(length);
  if (bytes.length !== length) throw new Error('Random source returned the wrong length');
  return bytes;
}
