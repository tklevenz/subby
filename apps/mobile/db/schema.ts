import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { LogPayload, PhotoBlob } from '@kindred-log/shared';
import { LOG_TYPES } from '@kindred-log/shared';

// Sync-relevant columns shared by every synced table (UUIDv7 ids, LWW updatedAt, soft delete).
const syncColumns = {
  updatedAt: integer('updated_at').notNull(),
  isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
  syncStatus: text('sync_status', { enum: ['pending', 'synced'] }).notNull().default('pending'),
  importRef: text('import_ref'),
};

export const childrenTable = sqliteTable(
  'children',
  {
    id: text('id').primaryKey(), // UUIDv7
    name: text('name').notNull(),
    birthDate: text('birth_date').notNull(), // YYYY-MM-DD
    birthTime: text('birth_time'), // HH:MM
    dueDate: text('due_date'),
    sex: text('sex', { enum: ['female', 'male', 'other'] }),
    photoUri: text('photo_uri'),
    // The synced photo (blob id + key); photoUri is this device's copy of it.
    photoBlob: text('photo_blob', { mode: 'json' }).$type<PhotoBlob>(),
    ...syncColumns,
  },
  (table) => [uniqueIndex('children_import_ref_idx').on(table.importRef)],
);

export const logsTable = sqliteTable(
  'logs',
  {
    id: text('id').primaryKey(), // UUIDv7
    childId: text('child_id').notNull(),
    logType: text('log_type', { enum: LOG_TYPES }).notNull(),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    createdBy: text('created_by'),
    // Drizzle serializes/deserializes the JSON column. Kept as one blob so it can be
    // end-to-end encrypted as a unit once sync lands.
    // NOTE: expo-sqlite in Expo Go is unencrypted. SQLCipher (useSQLCipher plugin option)
    // requires a dev client build.
    payload: text('payload', { mode: 'json' }).$type<LogPayload>().notNull(),
    ...syncColumns,
  },
  (table) => [
    index('child_started_idx').on(table.childId, table.startedAt),
    index('child_type_started_idx').on(table.childId, table.logType, table.startedAt),
    index('sync_status_idx').on(table.syncStatus),
    uniqueIndex('logs_import_ref_idx').on(table.importRef),
  ],
);

/** Device-local preferences (not synced). Values are JSON-encoded. */
export const settingsTable = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});

export const remindersTable = sqliteTable('reminders', {
  id: text('id').primaryKey(), // UUIDv7
  childId: text('child_id').notNull(),
  kind: text('kind', { enum: ['feed', 'medication', 'nap', 'custom'] }).notNull(),
  label: text('label').notNull(),
  intervalMin: integer('interval_min'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  notificationId: text('notification_id'), // expo-notifications identifier of the scheduled trigger
  ...syncColumns,
});
