import { z } from 'zod';
import { RECORD_KINDS } from './envelope';

/**
 * The sync server's HTTP contract (v1), shared by the server (validation) and the app (typed client).
 * Every value the server stores is either public key material, a signature, or ciphertext.
 */

const b64 = z.string().regex(/^[A-Za-z0-9_-]*$/, 'Expected base64url');
const uuid = z.string().uuid();
/** Who a sealed family key is for: a device id, or the recovery key. */
export const recipient = z.union([uuid, z.literal('recovery')]);

export const DeviceLogEntrySchema = z.object({
  index: z.number().int().nonnegative(),
  prev: z.string(),
  type: z.enum(['create', 'add', 'remove', 'setRecovery']),
  deviceId: recipient,
  signKey: b64.nullable(),
  boxKey: b64.nullable(),
  signer: recipient,
  at: z.number().int(),
  sig: b64,
});

// --- families -----------------------------------------------------------------------------------------

/** POST /v1/families: the first device creates the family with its signed `create` entry and epoch-1 key. */
export const CreateFamilySchema = z.object({
  familyId: uuid,
  entry: DeviceLogEntrySchema,
  /** The epoch-1 family key, sealed to the creating device. */
  sealedKey: b64,
});

/** POST /v1/families/me/log */
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
/** GET /v1/keys: every epoch sealed for the caller. */
export type KeysResponse = { currentEpoch: number; keys: SealedKey[] };

/** POST /v1/keys/grant: give a new member (or the recovery key) all existing epochs. */
export const GrantKeysSchema = z.object({
  recipient,
  keys: z.array(z.object({ epoch: z.number().int().positive(), sealed: b64 })).min(1),
});

/** POST /v1/keys/rotate: a new epoch, sealed to every current member (and the recovery key, if set). */
export const RotateKeysSchema = z.object({
  epoch: z.number().int().positive(),
  sealed: z.record(recipient, b64),
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
  epoch: z.number().int().positive(),
  updatedAt: z.number().int().nonnegative(),
  deviceId: uuid,
  deleted: z.boolean(),
  data: b64.max(Math.ceil((MAX_RECORD_DATA * 4) / 3)).nullable(),
  blobs: z.array(uuid).max(MAX_RECORD_BLOBS).optional(),
});

/** POST /v1/sync/push */
export const PushSchema = z.object({ records: z.array(SyncRecordSchema).min(1).max(MAX_PUSH) });
/** `stale`: the server has a newer version; pull to get it. */
export type PushResponse = { seq: number; accepted: string[]; stale: string[] };

/** GET /v1/sync/pull?since=<seq>&limit=<n> */
export type PullResponse = { records: (z.infer<typeof SyncRecordSchema> & { seq: number })[]; seq: number; more: boolean };

// --- push (hosted) -------------------------------------------------------------------------------------

/** PUT /v1/push/token: this phone's Expo push token. `GET /v1/info` says whether the server sends pushes. */
export const RegisterPushSchema = z.object({ token: z.string().min(1).max(256) });

// --- live (WebSocket /v1/live?token=) -----------------------------------------------------------------

export type LiveMessage =
  | { type: 'seq'; seq: number }
  | { type: 'log'; index: number }
  | { type: 'keys'; epoch: number }
  | { type: 'invite'; inviteId: string; status: InviteStatus };
