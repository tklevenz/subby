import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from './bytes';
import type { DeviceLogState } from './deviceLog';

/**
 * This phone's tag in the family (Android): a hash of Android's device id for this app (`ANDROID_ID`), which
 * survives clearing storage and reinstalling and changes only with a factory reset. Published by each phone on
 * its own encrypted `device` record, so the phone can tell its old entry after it joins again (`formerSelves`).
 * The id itself never leaves the phone.
 */
export const installTag = (androidId: string) => bytesToHex(sha256(utf8ToBytes(`subby/installtag/v1\u0000${androidId}`)));

/**
 * The family's other members that are this phone from before a reset or reinstall: it joined again as a new
 * phone, and its old entry can never sync again (its keys went with the old install). Only members that joined
 * before this phone: should the old entry ever run again, it never removes the new one.
 * - The same signing key: iOS keeps this phone's identity in the keychain across reinstalls.
 * - The same tag (Android, `installTag`). `tags` must hold only tags a phone published on its own record, so a
 *   member can only ever point at itself.
 */
export function formerSelves(state: DeviceLogState, me: string, myTag: string | null, tags: Readonly<Record<string, string>>): string[] {
  const mine = state.members.get(me);
  if (!mine) return [];
  const myKey = bytesToHex(mine.signKey);
  // Only phones that joined before this one (members are in join order): the newer entry is the one in use.
  const before = [...state.members].slice(0, [...state.members.keys()].indexOf(me));
  return before.filter(([id, m]) => bytesToHex(m.signKey) === myKey || (myTag !== null && tags[id] === myTag)).map(([id]) => id);
}
