import { z } from 'zod';
import { RECORD_KINDS } from './envelope';

/**
 * The sync server's HTTP contract (v1), shared by the server (validation) and the app (typed client).
 * Every value the server stores is either public key material, a signature, or ciphertext.
 */

/**
 * base64url, at most `max` characters (keys, signatures and sealed keys are far shorter than the default). A length
 * of 4n+1 can't be decoded, so it's refused here rather than failing later.
 */
const b64Of = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[A-Za-z0-9_-]*$/, 'Expected base64url')
    .refine((s) => s.length % 4 !== 1, 'Not valid base64url');
const b64 = b64Of(1024);
/** Postgres integer columns (epochs, log indexes) hold 32 bits. */
const int32 = z.number().int().nonnegative().max(2 ** 31 - 1);
const uuid = z.uuid();
/** Who a sealed family key is for: a device id, or the recovery key. */
export const recipient = z.union([uuid, z.literal('recovery')]);

export const DeviceLogEntrySchema = z.object({
  index: int32,
  prev: z.string().max(128),
  type: z.enum(['create', 'add', 'remove', 'setRecovery', 'epoch']),
  deviceId: recipient,
  signKey: b64.nullable(),
  boxKey: b64.nullable(),
  epoch: int32.positive().nullable(),
  keyHash: b64.nullable(),
  closedSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  signer: recipient,
  at: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sig: b64,
});

// --- families -----------------------------------------------------------------------------------------

/** POST /v1/families: the first device creates the family with its signed `create` entry (committing to the epoch-1 key) and that key sealed to itself. */
export const CreateFamilySchema = z.object({
  familyId: uuid,
  entry: DeviceLogEntrySchema,
  /** The epoch-1 family key, sealed to the creating device. */
  sealedKey: b64,
});

/** POST /v1/families/me/log: adds, removes and recovery changes. Epochs go through /v1/keys/rotate. */
export const AppendLogSchema = z.object({ entry: DeviceLogEntrySchema });

// --- auth ---------------------------------------------------------------------------------------------

/** POST /v1/auth/challenge: as a device, or as the recovery key (found by its signing key). */
export const ChallengeRequestSchema = z.union([
  z.object({ deviceId: uuid }),
  z.object({ recoverySignKey: b64 }),
]);
export type ChallengeResponse = { challenge: string; expiresAt: number };

/** POST /v1/auth/verify: signature over `authMessage(challenge)`. */
export const VerifyRequestSchema = z.object({ challenge: b64, signature: b64 });
export type VerifyResponse = { token: string; expiresAt: number; familyId: string; deviceId: string };

export const AUTH_CONTEXT = 'kindred/auth/v1';

// --- keys ---------------------------------------------------------------------------------------------

export type SealedKey = { epoch: number; recipient: string; sealed: string };
/**
 * GET /v1/keys: every epoch sealed for the caller. `currentEpoch` is only a hint: phones take the current epoch
 * from the verified device log and check each key against its commitment there (`openFamilyKey`).
 */
export type KeysResponse = {
  currentEpoch: number;
  keys: SealedKey[];
  /**
   * Members (device ids, or 'recovery') lacking some epochs, e.g. after an approval whose grant failed. Any phone
   * holding those keys grants them, sealed only to public keys from the verified log. Empty for the recovery key.
   */
  missing: { recipient: string; epochs: number[] }[];
};

/** POST /v1/keys/grant: give a new member (or the recovery key) all existing epochs. */
export const GrantKeysSchema = z.object({
  recipient,
  keys: z.array(z.object({ epoch: int32.positive(), sealed: b64 })).min(1).max(10_000),
});

/**
 * POST /v1/keys/rotate: a new epoch in one step: the signed `epoch` log entry (committing to the key) and the key
 * sealed to every current member (and the recovery key, if set).
 */
export const RotateKeysSchema = z.object({
  entry: DeviceLogEntrySchema,
  sealed: z.record(recipient, b64).refine((r) => Object.keys(r).length <= 1000, 'Too many recipients'),
});

// --- invites (pairing) --------------------------------------------------------------------------------

/**
 * POST /v1/invites. The QR code holds the one-time secret; the server only gets `claimHash`, the sha256 of a
 * claim key derived from it, so it can't compute the pairing code. See `invite.ts`.
 */
export const CreateInviteSchema = z.object({ inviteId: uuid, claimHash: b64 });

/** POST /v1/invites/:id/claim (no auth; proves the claim key). `mac` lets the inviting device check the keys. */
export const ClaimInviteSchema = z.object({
  claimKey: b64,
  deviceId: uuid,
  signKey: b64,
  boxKey: b64,
  mac: b64,
});

export type InviteStatus = 'open' | 'claimed' | 'approved' | 'expired';
/** GET /v1/invites/:id (the inviter) and POST /v1/invites/:id/status (the claimant, with its claim key). */
export type InviteResponse = {
  status: InviteStatus;
  familyId: string;
  claimant: { deviceId: string; signKey: string; boxKey: string; mac: string } | null;
};
export const InviteStatusSchema = z.object({ claimKey: b64 });

// --- sync ---------------------------------------------------------------------------------------------

export const MAX_RECORD_DATA = 256 * 1024;
export const MAX_PUSH = 500;
export const MAX_RECORD_BLOBS = 4;

// --- blobs (encrypted files: PUT/GET/DELETE /v1/blobs/:id, application/octet-stream) -------------------

/** Largest encrypted file the server accepts. Photos are picked at 0.7 quality, a few MB at most. */
export const MAX_BLOB_BYTES = 20 * 1024 * 1024;
/** Uploads no record has listed after this long are deleted (an abandoned or rejected upload). */
export const UNLINKED_BLOB_TTL_MS = 24 * 60 * 60 * 1000;

export const SyncRecordSchema = z.object({
  id: uuid,
  kind: z.enum(RECORD_KINDS),
  epoch: int32.positive(),
  updatedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  deviceId: uuid,
  deleted: z.boolean(),
  data: b64Of(Math.ceil((MAX_RECORD_DATA * 4) / 3)).nullable(),
  blobs: z.array(uuid).max(MAX_RECORD_BLOBS).optional(),
});

/** POST /v1/sync/push */
export const PushSchema = z.object({ records: z.array(SyncRecordSchema).min(1).max(MAX_PUSH) });
/** `stale`: the server has a newer version of these; `newer` carries those versions, so no full re-pull is needed. */
export type PushResponse = { seq: number; accepted: string[]; stale: string[]; newer: PullResponse['records'] };

/** GET /v1/sync/pull?since=<seq>&limit=<n> */
export type PullResponse = { records: (z.infer<typeof SyncRecordSchema> & { seq: number })[]; seq: number; more: boolean };

// --- push (hosted) -------------------------------------------------------------------------------------

/** PUT /v1/push/token: this phone's own push token (FCM on Android, APNs on iOS). `GET /v1/info` says whether the server sends pushes. */
export const RegisterPushSchema = z.object({ token: z.string().min(1).max(4096), platform: z.enum(['android', 'ios']).default('android') });

// --- payments (hosted Subby Sync only; PROJECT.md §3) ---------------------------------------------------

/**
 * Store product ids, the same on Google Play and the App Store. `unlock`: this phone's own, non-consumable,
 * restorable on the same store account. `slot`: a consumable gifted to the family, used by a phone without one.
 */
export const PRODUCTS = { unlock: 'sync_unlock', slot: 'sync_slot' } as const;
export type ProductKind = keyof typeof PRODUCTS;
export const productKind = (product: string): ProductKind | null =>
  product === PRODUCTS.unlock ? 'unlock' : product === PRODUCTS.slot ? 'slot' : null;

/** A new family syncs fully for this long. */
export const TRIAL_MS = 14 * 24 * 60 * 60 * 1000;
/** After the trial (or after joining, if later), a phone without an unlock still syncs for this long. */
export const GRACE_MS = 48 * 60 * 60 * 1000;
/** Photo storage per family on the hosted server. */
export const HOSTED_PHOTO_BYTES = 2 * 1024 ** 3;

/**
 * POST /v1/purchases: a store purchase made on this phone (or restored). `token` is Google's purchase token, or
 * Apple's signed StoreKit 2 transaction (`jwsRepresentation`). `test`: a pretend store for development, only
 * on servers started with TEST_PURCHASES=1 (`GET /v1/info` says `testPurchases`); its tokens are made up by the app.
 */
export const PurchaseSchema = z.object({
  store: z.enum(['google', 'apple', 'test']),
  product: z.enum([PRODUCTS.unlock, PRODUCTS.slot]),
  token: z.string().min(1).max(16_384),
});

/**
 * Why a phone may sync: `free` (a self-hosted server), `trial`, its own `unlock`, a family `slot`, or `grace`.
 * `readOnly`: it pulls but can't push until it's unlocked.
 */
export type SyncAccess = 'free' | 'trial' | 'unlock' | 'slot' | 'grace' | 'readOnly';

/** GET /v1/entitlement: this phone's access and the family's, for the unlock screens. */
export type EntitlementResponse = {
  access: SyncAccess;
  /** Null on a self-hosted server (no trial, nothing to pay). */
  trialEndsAt: number | null;
  /** When this phone's grace ends (it applies only without an unlock or slot). */
  graceEndsAt: number | null;
  /** Gifted slots the family has, and how many no phone uses yet. */
  slots: number;
  freeSlots: number;
  /** Every active phone and what lets it sync (`trial`/`grace`/`readOnly` for one without an unlock or slot). */
  devices: { id: string; access: SyncAccess }[];
  /** Photo storage used and allowed (null: unlimited). */
  photoBytes: number;
  photoLimit: number | null;
};

// --- live (WebSocket /v1/live?token=) -----------------------------------------------------------------

export type LiveMessage =
  | { type: 'seq'; seq: number }
  | { type: 'log'; index: number }
  | { type: 'keys'; epoch: number }
  | { type: 'invite'; inviteId: string; status: InviteStatus }
  /** A purchase, refund or membership change altered who may sync: re-read GET /v1/entitlement. */
  | { type: 'entitlement' };
