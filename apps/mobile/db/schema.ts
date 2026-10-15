import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { LogPayload } from '@kindred/shared';

export const logsTable = sqliteTable(
  'logs',
  {
    id: text('id').primaryKey(), // UUIDv7
    childId: text('child_id').notNull(),
    logType: text('log_type', { enum: ['diaper', 'feed', 'sleep'] }).notNull(),
    startedAt: integer('started_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
    syncStatus: text('sync_status', { enum: ['pending', 'synced'] }).notNull().default('pending'),
    // Drizzle automatically serializes/deserializes the JSON column locally.
    // Because op-sqlite uses SQLCipher, this entire database file is encrypted on disk.
    payload: text('payload', { mode: 'json' }).$type<LogPayload>().notNull(),
  },
  (table) => ({
    childStartedIdx: index('child_started_idx').on(table.childId, table.startedAt),
    syncStatusIdx: index('sync_status_idx').on(table.syncStatus),
  })
);
