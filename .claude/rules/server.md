---
paths:
  - "apps/server/**"
---

# `apps/server` (`@subby/server`, Subby Sync; AGPL-3.0, everything else is MIT)

A zero-knowledge sync relay: NestJS 12 on Fastify 5, PostgreSQL via Drizzle (`drizzle-orm/postgres-js`). It stores only ids, public keys, signatures, versions and ciphertext. The HTTP contract is `packages/shared/src/sync/protocol.ts` (`sync.md`), validated with `parse()` (`common/validate.ts`). Ops: the `server-ops` skill.

## Conventions
- The direct `fastify` dependency must equal the version the Nest Fastify adapter pins.
- No `emitDecoratorMetadata` (tsx, esbuild and vitest don't emit it): always inject with an explicit `@Inject(Token)`.
- **Write under a family's lock only through `familyTransaction(db, familyId, (tx, family) => …)`** (`db/lock.ts`), and never nest it for the same family. It queues the family's writes in process (then 429) before taking one of the pool's 10 connections.
- **Never log error messages** (drizzle's carry the query parameters): `SafeExceptionFilter` logs 5xx by class, Postgres code, table, constraint, route pattern and stack; background jobs use `logError(what, e)`, never `console.warn(…, e)`. Postgres 23505 → 409, 22xxx → 400 (still logged as a warning), lock/statement timeouts → 503.
- **Never ids, IPs or URLs** in metrics or log lines; count with `Metrics.count('<event>')` (Prometheus text on the container's own `127.0.0.1:8788`).
- Numbers in query parameters go through `queryInt`.
- Signatures are checked by OpenSSL (`common/ed25519.ts`, ~15x faster than noble). S3 goes through `aws4fetch`, pinned exactly: read the diff before upgrading (reviewed at 1.0.20). The image's healthcheck uses busybox `wget`, not a second Node.
- Single instance: auth challenges, rate limits and live sockets are in memory (scale out with Postgres LISTEN/NOTIFY).

## Endpoint invariants (`/v1`)
- **Auth:** `auth/verify` re-checks membership (or the current recovery key) under the family's lock, so a phone removed after its challenge gets no session. Challenges are stateless (HMAC with a per-process key, each answered once), so nobody can push a phone's challenge out by asking for many in its name. Sessions are stored hashed and capped per device.
- **Device log:** every append, restore and rotation replays the whole chain with `verifyDeviceLog`, checking only new entries' signatures (`{ trusted }` is for the server's stored entries; phones never pass it). `families/me/log` refuses `epoch` entries: a rotation goes through `keys/rotate`, as the signed entry plus the key sealed to exactly the current members plus the recovery key, in one transaction, with `closedSeq` equal to the family's seq (else 409, "Pull first"). The device id `recovery` is reserved.
- **Grants never overwrite** an existing sealed key.
- **Deleting a family leaves nothing:** the row cascades to every table, photo files are deleted, live sockets closed. So does a `remove` that leaves no active phone.
- **Invites:** the QR secret never reaches the server, only the hash of a derived claim key.
- **Push:** records must be written as the calling device, and new data (deletions too) in the current epoch. Tombstones may carry a sealed body or (older apps) none; everything else needs data.
- **Blobs:** a record can only link unlinked blobs or its own. Blobs a record stops listing, and all of a tombstone's, are deleted; a record without `blobs` (older app) keeps its links; unlinked uploads are swept after a day. An upload claims its id with the row first (under the family lock, with the allowance check), so a taken id is refused before the file is touched. Ids are lowercased.
- **Live sockets:** errors while connecting close the socket instead of reaching Nest (an unhandled rejection ends the process). Notifications are data-free.
- **Push notifications** are content-free. A push key that doesn't load turns that push off with an error and the server starts anyway (a malformed `apns.p8` once crash-looped production). APNs tries production, then the sandbox on `BadDeviceToken`, so the app needn't say which build it is.
- **Recovery-key sessions** (`deviceId === 'recovery'`) may only read the log and keys, append an `add`, grant (only to a phone the recovery key added), and delete the family. Never sync or rotate.

## Payments (hosted only, `MODE=hosted`; PROJECT.md §3; `purchases/`, `sync/entitlements.ts`)
- Each active phone's access, in join order: its own `unlock`, else a gifted `slot` (handed out in join order, so a removed phone's slot passes on), else `trial` (14 days from the second phone's first join; `trialStartsOnJoin` until then), else `grace` (48 h after the trial or after joining, if later), else `readOnly`. Self-hosted: `free`.
- No renewing grace by leaving and rejoining: a phone joining after the trial gets none if a phone without its own unlock left within `REJOIN_WINDOW_MS` (30 days) before it (`devices.left_locked_at`).
- `readOnly`: 402 on `sync/push` and blob uploads; pulling, the log and keys still work. Photos stop at 2 GB per family (403).
- `purchases` rows hold no personal data (`google:`+sha256(token), `apple:`+originalTransactionId). An unlock moves away from another active phone only with `move: true` (else 409 `UnlockInUseResponse`, purchase still finished); a slot belongs to the buyer's family for good.
- Google: Android Publisher API with a service account; refunds from `voidedpurchases`, checked hourly. Apple: StoreKit 2 JWS verified offline against the embedded Apple Root CA G3; refunds from App Store Server Notifications V2. Sandbox only with `APPLE_ALLOW_SANDBOX=1`.
- The test store (`TEST_PURCHASES=1`) is never on the official server.

## Abuse limits
- **A new member route with a large body goes in `LARGE_ROUTES`, or it answers 413. A new unauthenticated route with a body goes in `OPEN_ROUTES`, or it answers 401.** A body is read only after a valid session (`common/bodyGate.ts`), except on open routes (64 KB). Raw bytes only on the photo upload.
- **Match the router's route pattern** (`request.routeOptions.url`), never the URL, for open routes and rate limits: the router stops at `#` and decodes escapes, and re-parsing the URL once let `/v1/families#x` past the limits.
- Rate limits (`common/rateLimit.ts`): per rule and client (IPv6 by /64), plus a per-phone bucket; 429 with `Retry-After`. WebSocket upgrades skip Fastify's hooks, so `LiveGateway` limits them itself. `RATE_LIMIT=off` only for the e2e suite (every simulated phone is 127.0.0.1).
- `TRUST_PROXY=true` is refused (any client could pick its IP); name the proxy's addresses or ranges.
- Caps live in `protocol.ts` (field lengths, list sizes, 32-bit epochs and indexes) and as constants (family records and bytes, moves per device, log entries, transfers): new inputs get bounds too. Busy queues and transfers answer 429, never 503, so `monitor.sh`'s 5xx alert can't be set off at will.

## Housekeeping and tests
- Housekeeping (hourly): expired sessions and invites; hosted, families without a pull for 365 days are deleted like `DELETE families/me`, with a weekly push to their phones from day 335.
- Fastify runs with `forceCloseConnections: true` and `LiveGateway` terminates its sockets on destroy; otherwise an idle connection holds a restart for up to 60 s (the old flaky e2e teardown).
- `pnpm serve:dev` (needs `.env` from `.env.example`) is deliberately not named `dev`, so the root `pnpm run dev` only starts the app. `pnpm build` bundles the shared package with esbuild (npm dependencies stay external); `src/admin.ts` is a second entry.
- `test/e2e.test.ts` runs the real server on a throwaway database; the e2e suite uses a fake Play API and an openssl-made Apple chain (`test/appleCerts.ts`).
