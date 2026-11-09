import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { identityFromSeed, type IdentityKeys } from './keys';
import { randomBytes } from './random';

/** 24 BIP39 words (256 bits). Shown once; the server only ever sees the public keys derived from them. */
export const newRecoveryWords = () => entropyToMnemonic(randomBytes(32), wordlist);

/** Tolerates case, extra spaces and line breaks from people typing the words back in. */
export const normalizeRecoveryWords = (input: string) => input.trim().toLowerCase().split(/\s+/).join(' ');

export const isValidRecoveryWords = (input: string) => validateMnemonic(normalizeRecoveryWords(input), wordlist);

/** The recovery identity. Throws on a wrong word or checksum. */
export function recoveryIdentity(input: string): IdentityKeys {
  const words = normalizeRecoveryWords(input);
  if (!validateMnemonic(words, wordlist)) throw new Error('Those recovery words are not valid');
  return identityFromSeed(mnemonicToEntropy(words, wordlist));
}
