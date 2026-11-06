import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { DeviceLogEntry } from '@kindred-log/shared/crypto';

// Nothing here is readable user data: ids, public keys, signatures, versions and ciphertext.

export const families = pgTable('families', {
  id: uuid('id').primaryKey(),
  /** Last sync sequence number handed out in this family. */
  seq: bigint('seq', { mode: 'number' }).notNull().default(0),
  currentEpoch: integer('current_epoch').notNull().default(1),
  /** Recovery signing key from the device log, so the recovery key can find its family to log in. */
  recoverySignKey: text('recovery_sign_key').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** The signed, hash-chained membership log, stored verbatim; verified on every append. */
export const deviceLog = pgTable(
  'device_log',
  {
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(),
    entry: jsonb('entry').$type<DeviceLogEntry>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.familyId, t.index] })],
);

/** Current members, derived from the log (for auth lookups). Removed devices stay with active = false. */
export const devices = pgTable('devices', {
  id: uuid('id').primaryKey(),
  familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
  signKey: text('sign_key').notNull(),
  active: boolean('active').notNull().default(true),
  /** When it joined: its grace after the trial counts from here if it joined later (hosted payments). */
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Family keys sealed to one recipient (device id or 'recovery') per epoch. */
export const familyKeys = pgTable(
  'family_keys',
  {
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    epoch: integer('epoch').notNull(),
    recipient: text('recipient').notNull(),
    sealed: text('sealed').notNull(),
  },
  (t) => [primaryKey({ columns: [t.familyId, t.epoch, t.recipient] })],
);

/** Bearer tokens, stored as sha256. `deviceId` is 'recovery' for a recovery-key session. */
export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
  deviceId: text('device_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey(),
  familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
  /** sha256 of the claim key; the invite secret itself never reaches the server. */
  claimHash: text('claim_hash').notNull(),
  status: text('status', { enum: ['open', 'claimed', 'approved'] }).notNull().default('open'),
  claimant: jsonb('claimant').$type<{ deviceId: string; signKey: string; boxKey: string; mac: string }>(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

/**
 * Encrypted files (photos), stored in the blob store under `id`. `recordId` is the record that lists the
 * blob (null until one does; unlinked blobs are swept after a day). Size is kept for quotas.
 */
export const blobs = pgTable(
  'blobs',
  {
    id: uuid('id').primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id'),
    size: integer('size').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => [index('blobs_family_record_idx').on(t.familyId, t.recordId)],
);

/** Push: one token per device (removed with the device, or when the push service drops it). */
export const pushTokens = pgTable('push_tokens', {
  deviceId: uuid('device_id').primaryKey(),
  familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  /** `android` (an FCM token) or `ios` (an APNs token, not sent to yet). Older rows held Expo tokens; FCM refuses them and they're dropped. */
  platform: text('platform').notNull().default('android'),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

/** Encrypted records; the newest version per id (last writer wins), tombstones without data. */
export const records = pgTable(
  'records',
  {
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    id: uuid('id').notNull(),
    kind: text('kind', { enum: ['child', 'log', 'device', 'moved'] }).notNull(),
    epoch: integer('epoch').notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
    deviceId: uuid('device_id').notNull(),
    deleted: boolean('deleted').notNull(),
    data: text('data'),
    seq: bigint('seq', { mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.familyId, t.id] }), index('records_family_seq_idx').on(t.familyId, t.seq)],
);

/**
 * Store purchases on the hosted server (PROJECT.md §3), verified with the store. No personal data: a hash of
 * the store's purchase id, the product, and the phone or family it belongs to.
 */
export const purchases = pgTable(
  'purchases',
  {
    /**
     * `google:` + sha256 of the purchase token, `apple:` + the original transaction id, `test:` + sha256 of a
     * test-store token, or `grant:` + a random id (given with the admin command, no payment).
     */
    id: text('id').primaryKey(),
    store: text('store', { enum: ['google', 'apple', 'test', 'grant'] }).notNull(),
    kind: text('kind', { enum: ['unlock', 'slot'] }).notNull(),
    /** unlock: the phone using it now (one at a time; a restore moves it). slot: the phone that bought it. */
    deviceId: uuid('device_id').notNull(),
    /** slot: the family it was given to (deleted with it). unlock: null, it follows the phone. */
    familyId: uuid('family_id').references(() => families.id, { onDelete: 'cascade' }),
    /** Refunded or revoked by the store. */
    revoked: boolean('revoked').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('purchases_device_idx').on(t.deviceId), index('purchases_family_idx').on(t.familyId)],
);
