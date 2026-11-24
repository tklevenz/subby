---
paths:
  - "packages/shared/src/crypto/**"
  - "packages/shared/src/sync/**"
  - "apps/mobile/features/sync/**"
  - "apps/mobile/app/sync/**"
  - "apps/mobile/components/{SyncAccess,ServerChoice,QrCode}.tsx"
  - "apps/server/src/{families,keys,sync,auth,invites}/**"
  - "apps/server/test/client.ts"
---

# Sync and crypto (shared, app client)

Server side: `server.md`. `apps/server/test/client.ts` is a full simulated app and the reference for the mobile engine.

## Trust model: what every change must keep
The server is untrusted. Phones believe only what the signed device log and their own keys prove; a server may drop, replay or invent anything it stores, and must never be able to make a phone accept, lose or reveal data.
- **Device log** (`deviceLog`, `subby/devicelog/v1`): signed, hash-chained membership plus every key epoch's commitment (`keyHash = epochKeyHash(epoch, key)`). Every client verifies it.
  - Sealed boxes are anonymous, so a server could seal a key of its own: open keys only with `openFamilyKey` (checks the commitment), and take the current epoch from the log (`state.epoch`), never from the server.
  - Never accept a log older than the one already seen (`assertLogContinues` against `settings.sync.logSeen`): a prefix could hide a removal or a newer epoch.
  - Only devices start epochs, one at a time; the recovery key can only `add`. A removal or a replaced or cleared recovery key owes a rotation (`state.rotationDue`).
  - `epoch` entries carry `closedSeq`; older epochs' records end there (`withinEpoch`), so a removed phone writing with a key it still has is refused. Signed only when set, so older entries keep their signatures. Known limit: a phone that joins later can't tell such records from genuine history.
  - Grants and rotations seal only to public keys from the verified log.
- **Records:** metadata is bound as AAD (`envelope`). Tombstones carry a sealed empty body, so the server can't delete on its own; unsealed ones (older apps) are skipped.
- **A server can't make a phone drop an edit:** a stale push's row is marked synced only if a returned version (`PushResponse.newer`) beats it or is the very same version, and that version opens and passes the body check first (`settlePush`, `openAll`). Otherwise the row stays pending. There's no re-pull from 0.
- **Pulled records are refused** (skipped, not written) when their seq is outside the page asked for, their epoch closed before them, their epoch was already pulled to its end (`pulledEpochs`: only goes up, reset with the family), or they're below a restore floor (`belowFloors`). A page applies only the newest version per id (`newestOnly`) and phone names keep their versions (`nameVersions`), so a replayed copy never wins. A page that doesn't move forward, or claims more without ending at its last record (`pageContinues`), fails the run.
- **One bad record never stops sync:** skip what doesn't open or validate. Only a record of an epoch without a key fails the run (the next run fetches the key).
- **Bounded work for a hostile server:** the restore count only goes up and a phone resyncs at most once per 6 hours (`resyncedAt`); pushed ids the server answers neither way are held for the run, so a push can't loop.
- **Real store purchases go only to the official server** (`isOfficialServer`, `canBuyOn`): a purchase token moves the unlock to whoever presents it.
- Crypto: `@noble/*` and `@scure/bip39` only. React Native sets the random source (`setRandomSource` with `expo-crypto`; `keystore.ts` does it on import). The signature verifier is swappable (`setSignatureVerifier`, the server uses OpenSSL): a replacement may be stricter than noble's ZIP-215 rules, never looser.

## Data rules
- `protocol.ts` is the HTTP contract, shared by server and app. zod 4: `z.uuid()` and `.loose()`, not `z.string().uuid()` and `.passthrough()`.
- `merge`: last-writer-wins with a device-id tie-break, the same rule on server and client. It goes by phone clocks, so: the server refuses records more than `MAX_CLOCK_AHEAD_MS` (a day) ahead, the app re-dates pending rows from the future before pushing (`redateFutureEdits`), and a clock off by over 5 minutes is shown (`clockOff`).
- **Keep the pulled-body check lenient.** `isValidBody` uses `LenientPayloadSchema` (field types, not values) and must accept everything the strict schema does: a refused record is skipped for good (`lastSeq` moves on). Bodies are written as checked (`validBody`: a null optional field arrives as missing); unknown record kinds return null, so older apps skip them.
- Device-local, never synced: photo files (`photoUri`) and Baby Buddy import refs.
- **Photos:** an encrypted blob with its own key, referenced as `photoBlob: {id, key}` inside the encrypted record. Stores clear `photoBlob` whenever `photoUri` changes; uploading doesn't bump the row's version. Downloads take only UUID ids (they come from another phone's record). `SyncRecord.blobs` lists a record's blob ids (outside the AAD) so the server can delete unused ones. Blob transfers use `expo/fetch`. `queueUnsyncedPhotos` runs only when the family changes: run every time, it would re-push a photo that stays local forever.
- **Nothing blocks sync:** rows too large for `MAX_RECORD_DATA` stay pending and are skipped (`tooLarge`); photos over `MAX_BLOB_BYTES`, or refused (403 allowance full, 413), stay on the phone and the entry syncs without them; a 429 on a photo waits for the next run; pushes are split under `MAX_REQUEST_BYTES` (`pushChunks`).
- **Merge-join pulls before it pushes** (`settings.sync.merging`), so rows the family already has take the server's copy of the same millisecond (`clientApplies`), and only pending rows forget their photo references. Pushing first won every tie (the newest phone has the highest device id) and spread that phone's device-local gaps to everyone.
- A `readOnly` phone skips pushing (a 402 mid-run means the same) and keeps pulling; its entries stay pending until it's unlocked. Logging is never blocked.

## App client (`apps/mobile/features/sync/`)
- Keep new code in the right module: `state.ts` (`useSyncStore`, settings), `live.ts` (WebSocket), `apply.ts` (open, check and write pulled records), `pending.ts`, `records.ts` (row ↔ body), `photos.ts`, `family.ts` (pairing, removal, recovery), `move.ts`, `access.ts` (payments), `inactivity.ts`, `background.ts`, `engine.ts` (the rest). `engine.ts` and `move.ts` import each other. A run returns whether to run again; no hidden flags.
- `keystore.ts`: identity seed and family keys in SecureStore with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` (never in an iOS backup or on another phone); `kl.dbKey` stays `AFTER_FIRST_UNLOCK`, so a restored backup brings the data. `deviceIdentity()` never makes up a seed: a missing one throws `IdentityLostError` ("join again"). Only setup, join and recovery call `ensureDeviceIdentity()`. To test on the simulator, delete the `cku` items from its keychain db (`simctl keychain reset` takes the database key too).
- `syncNow` is serialized: verify the log (`refreshMembers`), refresh keys, `heal`, push pending rows in batches of 500 (marked synced only if unchanged since read), pull since `lastSeq` and apply in one transaction, download photos. Own echoes are skipped.
- `heal` (every run) finishes anything that stopped halfway: grants epochs `GET /v1/keys` lists as missing, rotates when `rotationDue` (another phone's concurrent rotation, a 400, is fine). So `approveClaim` and `setRecoveryKey` are safe to retry.
- `rotateKeys` pulls everything first and signs `closedSeq` = this phone's `lastSeq`; on 409 it pulls and retries, up to three times. Removing phones = a signed `remove` each, then one rotation.
- Live socket: the server sends a `ping` every `LIVE_HEARTBEAT_MS`; once one has arrived, a socket quiet for 2.5× that is replaced (Android's WebSocket never notices a socket the server dropped).
- `background.ts` is imported first by `index.ts`: headless launches render no screen. Push uses the phone's own token (`getDevicePushTokenAsync`, FCM or APNs): no Expo push service, no EAS. FCM needs `apps/mobile/google-services.json` (gitignored). Without push (no registered token) and with other phones, medication reminders say to check the app first.
- Notification permission is asked when sync starts (setup, join, recovery): removal messages have no switch of their own. A removed phone is told once and Home shows `SyncStopped` until sync is turned off.
- **Restored server:** phones give back log entries it lost, only when its log is an exact prefix of theirs (`entriesToRestore`; an empty log, a deleted family, is never restored). After `admin.js restored` (`restored.gen`) or a seq that went back (`serverWentBack`), a phone resyncs everything (`resyncAfterRestore`) and keeps a floor (`settings.sync.floors`). Not automatic: a family whose phones all joined after the backup.
- **Moving servers** (`move.ts`): the mover syncs, builds the new family (`movedFamilyLog`: same phones, keys and recovery key, a new epoch-1 key), uploads photos under their existing ids and keys, writes an encrypted `moved` record to the old family, then switches. A failure before the `moved` record deletes the new family. Followers check the new log with `verifyMovedLog` before following; that check is a security boundary, don't loosen it. A move that can't ever work is refused for good (`refusedMoves`); network and timing failures retry. `MovedBody.server` carries no user info, query or fragment. A `readOnly` phone may still push its small `moved` record.

## Payments in the app (`access.ts`, `store.ts`)
- Each run reads `GET /v1/entitlement` (404 from an older server = `free`) into `useAccessStore`.
- Buying: the test store whenever the server offers it, else Play/App Store through `expo-iap` (pinned to Play with `android.store` in app.json). Each purchase carries the device id (`obfuscatedAccountId`, `appAccountToken`). Google purchases are acknowledged/consumed by the server; StoreKit's are finished on the phone after the server took them.
- Each foreground run re-sends paid purchases that never reached the server. Never an acknowledged Android unlock: that would move it here.
- An unlock used by another active phone (`UnlockInUse`) is never moved silently: ask (move it, or buy a gift). After joining, `restoreQuietly` moves the store account's unlock only if no phone in use holds it, without `restorePurchases` (it can ask for the Apple ID password).
- Builds not from a store buy with test accounts only (license testers, sandbox); the server takes sandbox purchases only with `APPLE_ALLOW_SANDBOX=1`.

## Product decisions (don't undo without asking)
- No "delete the family" button: any phone can remove the others and leave; the last one leaving deletes the family. One phone shouldn't end sync for everyone in one tap.
- Setup and recovery use Subby Sync (`OFFICIAL_SERVER`) unless "Use your own server" is picked.
- Add a phone: no extra step before the QR code. A phone that joined after the trial is never told "your trial is over".
- After setting up alone: Add a phone first, then the recovery key (both skippable); a Home nudge after 3 days until there's a key or a second phone.
- `ShareNudge` shows once; never again after it's dismissed or sync is set up.
- The inactivity warning is a local notification rescheduled 11 months ahead after each run, so only a phone that stopped syncing sees it.
- `AccessDevTools` (dev builds, test-store servers, sandbox unlocks) is the app's only refund entry; real customers ask the store.
