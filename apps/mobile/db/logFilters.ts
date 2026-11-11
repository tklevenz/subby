import { and, inArray, isNull } from 'drizzle-orm';
import { TIMED_LOG_TYPES } from '@subby/shared';
import { logsTable } from './schema';

/** A running timer: a timed entry with no end yet. Always loaded and always included in a range, however old. */
export const runningTimer = () => and(isNull(logsTable.endedAt), inArray(logsTable.logType, [...TIMED_LOG_TYPES]));
