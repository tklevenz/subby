import { sql } from 'drizzle-orm';
import type { LogPayload } from '@subby/shared';
import { logsTable } from './schema';

/** A deleted log keeps only its id and type; nothing personal stays behind. */
export const scrubbedPayload = (type: LogPayload['type']) => ({ type }) as LogPayload;

type Fields = { updatedAt?: number; importRef?: null; syncStatus: 'pending' | 'synced' };

/** The `.set({…})` that deletes a log row this code has read (its type is known). */
export const deletedLog = (logType: LogPayload['type'], fields: Fields) => ({ isDeleted: true as const, payload: scrubbedPayload(logType), ...fields });

/** The same for many rows in one statement (all of a child's entries): the type comes from each row. */
export const deletedLogs = (fields: Fields) => ({ isDeleted: true as const, payload: sql`json_object('type', ${logsTable.logType})`, ...fields });
