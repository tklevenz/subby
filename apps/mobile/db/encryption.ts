/** Database files. The plain one is the pre-encryption database, and the only one in Expo Go. */
export const PLAIN_DB = 'kindred-log.db';
export const ENCRYPTED_DB = 'kindred.db';

export type OpenState = {
  /** The SQLite build is SQLCipher (dev/release builds; not Expo Go). */
  cipher: boolean;
  hasKey: boolean;
  hasPlain: boolean;
  hasEncrypted: boolean;
};

export type OpenPlan =
  /** No SQLCipher: open the plain database as before. */
  | { kind: 'plain' }
  /** Copy the plain database into a fresh encrypted one, then delete it. A leftover encrypted file is a half-done copy. */
  | { kind: 'encrypt'; newKey: boolean }
  /** The encrypted database exists but its key is gone (e.g. restored from a backup): keep the file aside, start empty. */
  | { kind: 'setAside' }
  | { kind: 'open'; newKey: boolean };

/** What to do at startup. The plain database is only deleted after a complete copy, so every step can be re-run. */
export function planOpen(s: OpenState): OpenPlan {
  if (!s.cipher) return { kind: 'plain' };
  if (s.hasPlain) return { kind: 'encrypt', newKey: !s.hasKey };
  if (s.hasEncrypted && !s.hasKey) return { kind: 'setAside' };
  return { kind: 'open', newKey: !s.hasKey };
}

/** SQLCipher raw key literal (64 hex chars = 256 bits), which skips the passphrase derivation on every open. */
export const rawKey = (hex: string) => `"x'${hex}'"`;

export const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
