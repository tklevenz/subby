# Launch plan

Everything left before Subby and the hosted Subby Sync (`sync.subby.baby`) launch together. There is no public beta: we test it ourselves on the production server before release. Written 2026-11-05. Tick items off here as they land.

IDs: **D** decisions, **S** server, **A** app, **P** payments, **O** operations, **L** legal, **R** store release. Dependencies are in brackets.

## Decisions first

These block tickets further down.

- [x] **D1 What's paid** (decided 2026-11-05).
  - The app is free and complete on its own. A single parent keeps everything on the phone, with the backup file for safety. The server is only for sharing: either the hosted Subby Sync (paid) or self-hosted (free).
  - **No free phone.** Every phone that syncs on the hosted server needs an unlock, bought once, in one of two ways:
    - **Its own unlock:** a non-consumable purchase on the person's store account. It's restorable on a new phone and comes along into any family; the server records which phone uses it, one at a time.
    - **A gift from the family:** any member buys a slot (a consumable). The slot belongs to the family, frees up when its phone is removed, and works on Android and iPhone alike.
  - **Price:** €6.99 per phone, the same for both kinds. No bundle.
  - **Trial:** a new family syncs fully for 14 days. No card, nothing renews automatically: the trial simply ends.
  - **Grace period:** after the trial, a phone without an unlock still syncs for 48 more hours (so a partner's phone doesn't stop mid-night), then reads but can't log until it's unlocked.
- [x] **D2 Photo allowance** (decided 2026-11-05): **2 GB per family**, no add-on. Past it, new photos stay on the phone. [S3]
- [x] **D3 Caregivers** (decided 2026-11-05): no free caregiver tier. A parent can gift a slot instead (D1).
- [x] **D4 Billing** (decided 2026-11-05): **our own verification** against Google Play and the App Store, no RevenueCat. [P1]
- [x] **D5 Inactivity** (decided 2026-11-05): a hosted family with no phone syncing for **12 months** is deleted from the server. The app warns from month 11 (30 days ahead). The phones keep everything. [S4]
- [x] **D6 Platforms** (decided 2026-11-05): **Android and iOS together.** iOS hasn't been prebuilt, run on a device or given push yet, so A7–A9 and R3 are in scope. Needs the Apple developer account.
- [x] **D7 Package id** (decided 2026-11-05): **`baby.subby.app`** (Android package and iOS bundle id). The Pixels reinstall once, then restore from a backup or re-join sync. A new Firebase app registration and `google-services.json` are needed. [R1]
  - Done in code 2026-11-08: `app.json` uses `baby.subby.app`; `app.config.js` skips a `google-services.json` without a client for it (warns, builds without push). Left (user): register the Android app `baby.subby.app` in the Firebase project `subby-4a0d9` and download the new `google-services.json` (the server's service-account key stays valid); move the Pixels over.
- [x] **D8 Hosting** (decided 2026-11-05): **Hetzner, Germany**. A Cloud VPS running the existing Docker compose (Postgres self-run), Hetzner Object Storage for photo blobs (`BLOB_STORE=s3`), nightly encrypted Postgres dumps to a separate bucket. [O1, O2]
- [x] **D9 Crash reporting** (decided 2026-11-05): **store consoles only** (Play Console, App Store Connect). No SDK. A10 is dropped.
- [x] **D10 Android ↔ iPhone** (decided 2026-11-05): an own unlock stays with its store (switching means buying again); gifted slots work on both.
- [x] **D11 Tip** (decided 2026-11-05): not at launch.
- [x] **D12 Push** (decided 2026-11-05).
  - Hosted: included (FCM done, APNs = A9). On iOS the content-free push is a background push that iOS may delay, so family alerts on iPhones can be late.
  - Self-hosted: no push at launch (live sync while open, OS background sync, "check the app first" on medication reminders).
  - **After launch:** a free, rate-limited push relay through `sync.subby.baby`, which the self-hoster switches on. It sees only push tokens and timing. UnifiedPush only if asked for.
  - Local reminders never need push.

## Server (Subby Sync)

- [x] **S1 Rate limiting** (per client IP; `common/rateLimit.ts`). On `auth/challenge`, `auth/verify`, `invites` (create, claim, status), `families` (create), blob uploads and push token registration. In memory is fine (the server is single-instance).
- [x] **S2 `trustProxy`** for Fastify behind Caddy, so limits and logs see the real client IP. Off by default for self-hosters without a proxy.
- [x] **S3 Photo allowance.** `Entitlements.canStore` sums the family's blob sizes in hosted mode. Self-hosted stays unlimited. [D2]
- [ ] **S4 Inactive-family cleanup.** **Must be done before hosted sync opens:** subby.baby (/sync/, /privacy/) already promises deletion after 12 months with a warning in the app from month 11. Track the last sync per family; housekeeping warns (a live/push message the app shows) and later deletes. Deleting a family also deletes its gifted slots, so the warnings must say so. [D5, S5]
- [x] **S5 Deleting a family's data.**
  - When the last phone leaves, delete everything: records, keys, the device log, blobs, push tokens and the family row.
  - Also a "Delete this family from the server" action in the app, for any member. Today nothing is ever deleted.
  - App: Sync settings button with a type-to-confirm.
- [x] **S6 Hosted-mode entitlements.**
  - A family's trial start (14 days from creation), plus a 48-hour grace per phone after the trial ends.
  - Own unlocks (purchase → the phone currently using it), and gifted slots (a count per family, each assigned to a member phone, freed on removal).
  - `canSync` per device: in the trial, or with an own unlock or an assigned slot → push allowed; otherwise pull only.
  - Self-hosted mode always allows everything. [D1, P1]
- [ ] **S7 Metrics and logs without user data.** Request counts, error rates, family/blob totals; never ids or IPs in long-lived logs. `/healthz` done (Postgres and photo storage); Caddy keeps no access log.
- [ ] **S8 Dependency refresh** before launch (NestJS 12.2+ / fastify 5.12.7 clears the open low advisory), and `pnpm audit`.
- [ ] **S9 Far-future `updatedAt` (audit S-7 leftover).** Decide whether to clamp. A phone with a wrong clock would win every edit; a clamp could get it stuck. At minimum, show a clock-skew warning in the app.

## App

- [x] **A1 Remove the premium gates.**
  - `FREE_CHILD_LIMIT` / `useCanAddChild`, `PremiumGate` on `child/new`, the Baby Buddy import default, the Trends and Settings bits, `childLimit.test.ts`.
  - Keep `isPremium` only as a hosted-sync concept (renamed, e.g. `unlocked`).
- [x] **A2 Photo compression on pick.** Long edge ~2048 px (avatars ~512 px), re-encoded as JPEG. Existing photos stay.
- [ ] **A3 Unlock flow.** Done 2026-11-05 with the test store: access card, phone labels, gifting, Home banner, dev pretend switch, family id for grants (`admin.js grant-slots`). Left: the real stores through `expo-iap` (after D7 and the console setup). Changed from the plan: a read-only phone keeps logging locally (pending until unlocked) instead of being blocked.
  - Trial days left (no card, no auto-renew), the 48-hour grace notice, and buying an unlock for this phone. "Restore purchases" brings back an own unlock.
  - Gifting a slot while adding a phone (or later, from the phone list), and assigning a free slot.
  - The "this phone can read but not log" state on the Sync screen and Home, with logging blocked in the UI (not silently queued for ever).
  - Setup copy: sharing costs, the app alone is free, self-hosting is free. [P1, S6]
- [ ] **A4 Server-side warnings** (inactivity, storage full) shown on the Sync screen. [S3, S4] Before hosted sync opens: the website promises the month-11 warning.
- [x] **A5 Default server.** Done 2026-11-06: setting up and recovering use `https://sync.subby.baby`; the address field only shows after "Use your own server".
- [ ] **A6 Small UX leftovers.**
  - "Discard changes?" when leaving an editor with edits.
  - "waking" → "night waking" in NightForm (unanswered suggestion).
  - "Medication given on another phone" notification (suggested, undecided).
- [ ] **A7 iOS bring-up** (if D6): prebuild, run on a device, SQLCipher, notifications, background task, the share sheet for backups, the camera/QR flow. [D6]
- [ ] **A8 S-15: iOS keychain `THIS_DEVICE_ONLY`**, plus an "identity lost → re-join" flow, because `deviceIdentity()` silently creates a new seed today. [A7]
- [ ] **A9 APNs push**: server sender (`node:http2`, ES256 `.p8` JWT, background push), iOS token path, e2e fake. [A7, Apple account]
- [x] ~~**A10 Crash reporting**~~: not needed (D9).
- [ ] **A11 About / legal in Settings**: version, licenses (MIT/AGPL, Font Awesome credit already there), privacy policy and terms links, source code link. [L1, L2]
- [ ] **A13 Move to another server** (Sync screen; official ↔ self-hosted, either way), without re-pairing. Built 2026-11-06 (shared log checks, app, server, e2e between two servers); not yet tried on phones.
  - The moving phone pulls everything, creates a new family on the new server whose log adds every current phone and keeps the same recovery key, seals the new family key to them, and uploads every entry and photo (same photo ids and keys).
  - It then writes an encrypted `moved` record (new server, family id, the old seq it had pulled to) to the old family.
  - The other phones follow on their next sync: they check the new log against the members they already trust, switch, and re-send what they wrote after that seq. The old family is deleted once everyone has moved; a phone that missed it joins with a code.
  - Moving to the official server starts the trial; unlocks are restored from the store account.
- [ ] **A12 Accessibility pass**: screen-reader labels on tiles, icon buttons and the wheel picker; font scaling; reduced motion (the brand subs already respect it).

## Payments

- [ ] **P1 Store products.** Server side done 2026-11-05 (`purchases/`, verified against a fake Play API and a test Apple chain). Left: creating the products and the service account in the consoles, and the app (A3). Play Billing and StoreKit, two products per store at €6.99: the own unlock (non-consumable) and the family slot (consumable).
  - The purchase carries the buyer's device id (`obfuscatedAccountId` / `appAccountToken`).
  - Server: a purchases table (store, transaction id, kind, device or family), our own receipt verification (Play Developer API, App Store Server API), one active phone per own unlock; refunds revoke (Play voided purchases, App Store server notifications). [D1, D4]
- [x] **P3 E2E tests** (server, 2026-11-05) with a fake store verifier:
  - trial expiry → 48 h grace → pull only;
  - own unlock, and restoring it to a new phone in another family;
  - gifting a slot, freeing it on removal, reassigning it;
  - a refund.

## Operations

- [ ] **O1 Production host.** Running since 2026-11-06 at `https://sync.subby.baby` (Hetzner CPX02, Ubuntu 26.04, 2 GB swap, ufw 22/80/443, SSH keys only; Object Storage for photos; `apps/server/deploy/production`). Left: the Firebase key (push is off until then).
  - Server + Postgres + blob storage at `sync.subby.baby`, Caddy with HTTPS and HSTS, `HTTP_BIND=127.0.0.1`.
  - The production Firebase service-account key in `./secrets`. [D8]
- [ ] **O2 Backups.** Nightly Postgres dumps and blob storage versioning, kept off the host, encrypted. **Do a test restore before launch.**
- [ ] **O3 Monitoring.** Uptime check on `/healthz`, disk and DB size alerts, a TLS expiry check. [S7]
- [x] **O4 Deploy procedure.** `apps/server/deploy/production/deploy.sh`: builds the commit as `subby-sync:<sha>`, ships it, dumps the database, starts, waits for `/healthz`; `--rollback`. Then `pnpm --filter @subby/server smoke https://sync.subby.baby`.
- [ ] **O5 Website** at `subby.baby` (designed separately): home, how Sync works, pricing, self-hosting, privacy, Impressum. Static, no trackers, self-hosted fonts, HSTS.
- [ ] **O6 Email**: `support@subby.baby`, `privacy@` and `security@` (named in SECURITY.md), with SPF/DKIM/DMARC.
  - Receiving works since 2026-11-06 (Porkbun forwarding to Gmail).
  - Left: sending as subby.baby through an SMTP service with a DKIM-signed sender domain (Brevo, SMTP2GO, Mailjet or Porkbun email), used from Gmail's "Send mail as"; one SPF record including it; DMARC on `_dmarc` starting at `p=none`, then `quarantine` once everything goes out signed.
- [x] **O7 Public repo.** LICENSE files (MIT root, app, shared; AGPL server), README, SECURITY.md (security@subby.baby, needs O6) on 2026-11-05. Public since 2026-11-09 as https://github.com/tklevenz/subby (history checked for secrets, author emails moved to the GitHub noreply address); the website links it. The website's own repo, tklevenz/subby.baby, stays private.
- [ ] **O8 Trademark note** for "Subby" in the README, plus checking the name and marks aren't taken in the app category (EU/US).
- [ ] **O9 Dogfood run.** Our own family on the production server for two weeks or more, both Pixels (and an iPhone if D6), including a phone removal, a recovery and a restore from backup.

## Legal

- [ ] **L1 Privacy policy.**
  - What the server sees: ids, public keys, signatures, versions, sizes, timestamps, IPs, push tokens, purchases.
  - What it never sees, how long things are kept, deletion (S5), processors (host, Google FCM, Apple APNs, the store, RevenueCat if chosen).
- [ ] **L2 Terms of service** for the hosted server, and a refund note.
- [ ] **L3 Impressum** (if operating from Germany), and data-processing agreements with the host and any processors.
- [ ] **L4 Medical disclaimer.** Not medical advice (growth percentiles, nap prediction, medication reminders).

## Store release

- [ ] **R1 Final package id and signing.**
  - A real release keystore (today release APKs use the debug key), kept safe and backed up, plus Play App Signing.
    - Signing plugin done 2026-11-08: `SUBBY_SIGNING=<upload.properties> npx expo prebuild --clean --platform android`. Left: create the upload key (`keytool -genkeypair -keystore subby-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000`), back it up with its passwords, and enrol in Play App Signing on the first upload (`bundleRelease` for an .aab).
  - Prebuild **without** `SUBBY_ALLOW_HTTP`. [D7]
- [ ] **R2 Google Play listing**: "Subby: Private Baby Tracker", description, screenshots, feature graphic, the data safety form (matches L1), content rating, target audience (parents, not children), the data deletion URL (S5 + website).
- [ ] **R3 App Store listing** (if D6): the same, plus privacy nutrition labels and review notes (no account; how to test sync).
- [ ] **R4 Internal / closed testing track.** Play requires a closed test with testers for new personal developer accounts before production. Check what applies to the account.
- [ ] **R5 Version and changelog.** 1.0.0, `versionCode`, and a short "what's new".
- [ ] **R6 Release-build smoke test** on a fresh phone: onboarding, Baby Buddy import, backup and restore, sync setup on `sync.subby.baby`, join a second phone, push, unlock purchase.

## After launch

- [ ] **X1 Push relay for self-hosted servers** (D12): free, rate-limited, switched on by the self-hoster; forwards content-free "sync now" pings to FCM/APNs.
- [ ] **X2 One trial per phone.** Today turning sync off and setting it up again starts a new family with a new 14-day trial, and any client can use the open protocol. If the numbers show trial restarts: Play Integrity (device recall bits) and App Attest/DeviceCheck (2 bits per device) to mark "trial used" on the phone, checked when a family is created or a phone joins. Only for the trial, never a condition for syncing; phones that can't attest just don't get a second trial.
- [ ] **X3 Home Assistant bridge.** For families coming from Baby Buddy. The server only holds ciphertext, so Home Assistant joins the family as a phone of its own:
  - A small bridge (Node, Docker, next to Home Assistant) pairs by QR code + 6-digit code, holds the family key, decrypts locally and publishes sensors over MQTT discovery ("sleeping since", "last feed", "diapers today", "next nap"); optionally services to log ("log a diaper").
  - Reuses `packages/shared` (crypto, device log, records) and the sync flow of `apps/server/test/client.ts`. It shows up in the phone list and is removed like any phone. No native Python integration (that would mean re-implementing the crypto).
  - Payments: reading needs no unlock (a read-only phone still pulls), so sensors are free on Subby Sync after the trial; logging from Home Assistant needs an unlock like any phone (the server can't tell a bridge from a phone in an open protocol). Free on self-hosted servers, where most Home Assistant users will be.

## Order

1. ~~Decisions~~ (all made 2026-11-05).
2. Small and independent: S1, S2, S5, A1, A2, O7.
3. Payments: P1, S6, A3, P3, then S3, S4, A4.
4. iOS, if launching on it: A7, A8, A9.
5. Operations O1–O4 and legal L1–L4, then the website (O5).
6. Dogfood (O9) on the production server with release builds.
7. Store release R1–R6.
