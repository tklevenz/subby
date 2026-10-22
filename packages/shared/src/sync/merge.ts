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
