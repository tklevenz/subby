export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatRelative(msAgo: number): string {
  const totalSec = Math.max(0, Math.floor(msAgo / 1000));
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);

  if (d > 0) return `${d}d ${h}h ago`;
  if (h > 0) return `${h}h ${m}m ago`;
  if (m > 0) return `${m}m ago`;
  return 'Just now';
}

/** Local-time start of day (00:00) for the given epoch ms. */
export function startOfDay(epochMs: number): number {
  const d = new Date(epochMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Age in whole days between an ISO birth date (YYYY-MM-DD, local) and `now`. */
export function ageInDays(birthDate: string, now: number): number {
  const [y, m, d] = birthDate.split('-').map(Number);
  const birth = new Date(y, m - 1, d).getTime();
  return Math.floor((startOfDay(now) - birth) / 86_400_000);
}

export function formatAge(birthDate: string, now: number): string {
  const days = ageInDays(birthDate, now);
  if (days < 0) return 'Not born yet';
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 7 * 13) return `${Math.floor(days / 7)} weeks`;
  const months = Math.floor(days / 30.4375);
  if (months < 24) return `${months} months`;
  return `${Math.floor(months / 12)} years`;
}
