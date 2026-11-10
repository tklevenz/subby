import { formatNumber, t } from '../i18n';
import { TIMED_LOG_TYPES, type LogEntry, type LogType, type PayloadOf } from '../schemas/log.schema';

export type EntryOf<T extends LogType> = LogEntry & { logType: T; payload: PayloadOf<T> };

const isType =
  <T extends LogType>(type: T) =>
  (l: LogEntry): l is EntryOf<T> =>
    !l.isDeleted && l.logType === type && l.payload.type === type;

/** Most recent entry of a type. Assumes `logs` is sorted by startedAt DESC. */
export function lastOfType<T extends LogType>(logs: LogEntry[], type: T): EntryOf<T> | undefined {
  return logs.find(isType(type));
}

/** A timed entry is running while it has no end. Completed timed entries always have endedAt set. */
export function isRunning(l: LogEntry): boolean {
  return !l.isDeleted && l.endedAt === null && TIMED_LOG_TYPES.includes(l.logType);
}

/** Running timers, newest first. */
export function activeTimers(logs: LogEntry[]): LogEntry[] {
  return logs.filter(isRunning);
}

export function activeSleep(logs: LogEntry[]): EntryOf<'sleep'> | undefined {
  return logs.find((l): l is EntryOf<'sleep'> => isType('sleep')(l) && l.endedAt === null);
}

/**
 * A sleep overlapping [start, end) (end null: still going), so the same time isn't logged as two sleeps.
 * Running sleeps last until stopped. `exclude` skips the entry (or entries) being edited. Touching ends don't overlap.
 */
export function overlappingSleep(logs: LogEntry[], start: number, end: number | null, exclude?: string | string[]): EntryOf<'sleep'> | undefined {
  const until = end ?? Infinity;
  const excluded = new Set(typeof exclude === 'string' ? [exclude] : exclude);
  return logs.find(
    (l): l is EntryOf<'sleep'> =>
      isType('sleep')(l) && !l.isDeleted && !excluded.has(l.id) && l.startedAt < until && (l.endedAt ?? Infinity) > start,
  );
}

/** When the current wake window started: end of the most recent finished sleep. */
export function lastWakeAt(logs: LogEntry[]): number | null {
  const ended = logs.find((l) => !l.isDeleted && l.logType === 'sleep' && l.endedAt !== null);
  return ended?.endedAt ?? null;
}

const pair = (a: string, b: string) => t('summary.pair', { a, b });

export function describeFeed(p: PayloadOf<'feed'>): string {
  switch (p.method) {
    case 'bottle': {
      const milk = p.milkType === 'formula' ? t('feed.formula') : p.milkType ? t('feed.breastMilk') : t('feed.bottle');
      return p.amountMl !== undefined ? pair(milk, `${formatNumber(Math.round(p.amountMl))} ml`) : milk;
    }
    case 'breast': {
      const l = p.leftSeconds ?? 0;
      const r = p.rightSeconds ?? 0;
      const sides = l > 0 && r > 0 ? t('feed.bothSides') : r > 0 ? t('feed.right') : l > 0 ? t('feed.left') : t('feed.breast');
      const mins = Math.round((l + r) / 60);
      return mins > 0 ? pair(sides, t('feed.minutes', { count: mins })) : sides;
    }
    case 'solids':
      return p.foods?.length ? pair(t('feed.solids'), p.foods.join(t('list.join'))) : t('feed.solids');
  }
}

export function describeDiaper(p: PayloadOf<'diaper'>): string {
  const condition = t(`diaper.${p.condition}`);
  return p.color ? pair(condition, t(`diaperColor.${p.color}`)) : condition;
}

/** Which breast to offer next, based on the last breastfeed. */
export function suggestedNextSide(logs: LogEntry[]): 'left' | 'right' | null {
  const last = logs.find(
    (l): l is EntryOf<'feed'> => isType('feed')(l) && l.payload.method === 'breast',
  );
  if (!last) return null;
  const side = last.payload.lastSide
    ?? ((last.payload.rightSeconds ?? 0) > (last.payload.leftSeconds ?? 0) ? 'right' : 'left');
  return side === 'left' ? 'right' : 'left';
}
