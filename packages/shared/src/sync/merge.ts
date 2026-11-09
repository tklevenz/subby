export type Version = { updatedAt: number; deviceId: string };

/** Total order on versions: later edit wins; the same millisecond is broken by device id. */
export function compareVersions(a: Version, b: Version): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
  return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;
}

/** Server side: keep the incoming record only if it is newer than what is stored. */
export const serverAccepts = (stored: Version | null, incoming: Version) =>
  stored === null || compareVersions(incoming, stored) > 0;

/**
 * Client side, for a pulled record. Local rows don't remember who wrote them; an unpushed (pending) row
 * was written here, a synced one already matches the server.
 */
export function clientApplies(
  local: { updatedAt: number; pending: boolean } | null,
  incoming: Version,
  ownDeviceId: string,
): boolean {
  if (local === null) return true;
  if (!local.pending) return incoming.updatedAt >= local.updatedAt;
  return compareVersions(incoming, { updatedAt: local.updatedAt, deviceId: ownDeviceId }) > 0;
}

/**
 * Client side, after a push: which pushed rows are settled (marked synced) and which winning versions replace
 * them. A stale row is settled only when `newer` carries a version that beats it and passes `usable` (an epoch
 * this phone holds a key for, not closed before it); otherwise it stays pending (`held`), so a server can't make a
 * phone drop an edit by calling it stale.
 */
export function settlePush<R extends Version & { id: string; seq: number; epoch: number }>(
  pushed: readonly (Version & { id: string })[],
  res: { accepted: string[]; stale: string[]; newer?: R[] },
  usable: (record: R) => boolean,
): { settled: string[]; held: string[]; newer: R[] } {
  const mine = new Map(pushed.map((r) => [r.id, r]));
  const stale = new Set(res.stale.filter((id) => mine.has(id)));
  const newer = (res.newer ?? []).filter((r) => stale.has(r.id) && usable(r) && compareVersions(r, mine.get(r.id)!) > 0);
  const beaten = new Set(newer.map((r) => r.id));
  return {
    settled: [...res.accepted.filter((id) => mine.has(id) && !stale.has(id)), ...beaten],
    held: [...stale].filter((id) => !beaten.has(id)),
    newer,
  };
}

/** Client side: a pull page must move forward from `since`, or a server could loop a phone forever or rewind it. */
export const pageContinues = (since: number, page: { seq: number; more: boolean }) =>
  page.seq > since || (page.seq === since && !page.more);
