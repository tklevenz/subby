import { TIMED_LOG_TYPES, type LogEntry, type LogType, type PayloadOf } from '../schemas/log.schema';

export type EntryOf<T extends LogType> = LogEntry & { logType: T; payload: PayloadOf<T> };

const isType =
  <T extends LogType>(type: T) =>
  (l: LogEntry): l is EntryOf<T> =>
    l.logType === type && l.payload.type === type;

/** Most recent entry of a type. Assumes `logs` is sorted by startedAt DESC. */
export function lastOfType<T extends LogType>(logs: LogEntry[], type: T): EntryOf<T> | undefined {
  return logs.find(isType(type));
}

/** A timed entry is running while it has no end. Completed timed entries always have endedAt set. */
export function isRunning(l: LogEntry): boolean {
  return l.endedAt === null && TIMED_LOG_TYPES.includes(l.logType);
}

/** Running timers, newest first. */
export function activeTimers(logs: LogEntry[]): LogEntry[] {
  return logs.filter(isRunning);
}

export function activeSleep(logs: LogEntry[]): EntryOf<'sleep'> | undefined {
  return logs.find((l): l is EntryOf<'sleep'> => isType('sleep')(l) && l.endedAt === null);
}

/** When the current wake window started: end of the most recent finished sleep. */
export function lastWakeAt(logs: LogEntry[]): number | null {
  const ended = logs.find((l) => l.logType === 'sleep' && l.endedAt !== null);
  return ended?.endedAt ?? null;
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function describeFeed(p: PayloadOf<'feed'>): string {
  switch (p.method) {
    case 'bottle': {
      const milk = p.milkType === 'formula' ? 'Formula' : p.milkType ? 'Breast milk' : 'Bottle';
      return p.amountMl !== undefined ? `${milk} · ${Math.round(p.amountMl)} ml` : milk;
    }
    case 'breast': {
      const l = p.leftSeconds ?? 0;
      const r = p.rightSeconds ?? 0;
      const sides = l > 0 && r > 0 ? 'Both sides' : r > 0 ? 'Right' : l > 0 ? 'Left' : 'Breast';
      const mins = Math.round((l + r) / 60);
      return mins > 0 ? `${sides} · ${mins} min` : sides;
    }
    case 'solids':
      return p.foods?.length ? `Solids · ${p.foods.join(', ')}` : 'Solids';
  }
}

export function describeDiaper(p: PayloadOf<'diaper'>): string {
  return p.color ? `${titleCase(p.condition)} · ${p.color}` : titleCase(p.condition);
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
