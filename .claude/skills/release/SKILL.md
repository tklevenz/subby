---
name: release
description: Make a store release of the Subby app - version bump, preflight checks, the upload-signed Android .aab for Play Console, the iOS archive for App Store Connect, checks on the built artifact, tags and follow-up. Use when the user asks for a store build, an upload to a Play or TestFlight/App Store track, a new versionCode or build number, or the launch release (LAUNCH.md R1-R6).
---

# Store release

The user uploads and submits in Play Console and App Store Connect; Claude never does (no console access). Claude prepares, builds, checks the artifact and says where it is. Local device builds are the `native-build` skill.

## 1. Preflight
Stop and tell the user if any of these fails.
- On `main`, clean tree, pushed. CI green for HEAD (there's no `gh`; the repo is public):
  `curl -s "https://api.github.com/repos/tklevenz/subby/actions/runs?head_sha=$(git rev-parse HEAD)" | jq -r '.workflow_runs[] | "\(.status) \(.conclusion)"'`
- `cd apps/mobile && npx expo install --check`.
- Licenses: if `pnpm-lock.yaml` changed since the platform's last release tag (`git diff --quiet android-<prev>..HEAD -- pnpm-lock.yaml`; no tag yet = run it), run `node scripts/licenses.mjs` in `apps/mobile` and commit `assets/licenses.json`.
- Server first: if the app needs server changes that aren't on `sync.subby.baby` yet, deploy them before the build reaches anyone (`apps/server/deploy/production/deploy.sh`, see `server-ops`).
- Never prebuild a store build with `SUBBY_ALLOW_HTTP`.

## 2. Version (`apps/mobile/app.json`)
- `expo.version`: what users see (versionName / CFBundleShortVersionString). Ask the user before changing it; launch is `1.0.0` (R5).
- `expo.android.versionCode`: +1 for every Play upload, any track. Play never accepts a number twice, even for a deleted release.
- `expo.ios.buildNumber` (a string; unset means "1"): must grow with every upload of the same version. Set it explicitly.
- Commit the bump before building (`chore(mobile): versionCode N for <track>`), so every artifact matches a commit.

## 3. Android: upload-signed .aab
```
cd apps/mobile
SUBBY_SIGNING=$HOME/subby-signing/upload.properties npx expo prebuild --clean --platform android --no-install
(cd android && ./gradlew bundleRelease)
```
Output: `android/app/build/outputs/bundle/release/app-release.aab`. Check it before handing it over:
- Signer is the upload key: `keytool -printcert -jarfile <aab> | grep SHA256` must show `12:4F:FF:24:…:59:A7`. Anything else (the debug key) and Play rejects it.
- Manifest: `M=$(find android/app/build/intermediates -path '*release*' -name AndroidManifest.xml | grep -E 'bundle_manifest|packaged_manifests|merged_manifest' | head -1)`, then `grep -oE 'com.android.vending.BILLING|usesCleartextTraffic="[a-z]+"|android:versionCode="[0-9]+"|android:versionName="[^"]+"' "$M"`: BILLING present, no `usesCleartextTraffic="true"`, the version from step 2. Also no `RECORD_AUDIO` or `SYSTEM_ALERT_WINDOW` (`grep -c 'RECORD_AUDIO\|SYSTEM_ALERT_WINDOW' "$M"` is 0): `expo-image-picker` and Expo's template add them, and `android.blockedPermissions` in app.json takes them out (they'd show on the Play listing and in Data safety).
- Push: the prebuild must not print `has no Android app baby.subby.app; building without push` (`google-services.json` missing or wrong).

The user uploads it: Play Console → Testing (internal/closed) or Production → Create release.

**Afterwards, `android/` is prebuilt with the upload key.** Upload-signed builds can't install over the Pixels' debug-signed app (it would mean uninstalling and losing data), so prebuild without `SUBBY_SIGNING` before the next Pixel build. Never install a store build on the family's Pixels.

## 4. iOS: archive for App Store Connect (never done yet)
**Not verified:** the first upload is still to come (R3). Follow this, report what differed, and rewrite this section with what actually worked.
```
cd apps/mobile && npx expo prebuild --clean --platform ios
cd ios && xcodebuild -workspace Subby.xcworkspace -scheme Subby -configuration Release \
  -destination 'generic/platform=iOS' -archivePath ~/Library/Developer/Xcode/Archives/Subby-<buildNumber>.xcarchive -allowProvisioningUpdates archive
```
- Upload: the user opens the archive in Xcode (Window → Organizer → Distribute App → App Store Connect). Or `xcodebuild -exportArchive` with an ExportOptions.plist (`method` app-store-connect, `destination` upload, `teamID` L33LRKM2NX, automatic signing); that needs the Apple account signed in to Xcode.
- **Export compliance, open:** `app.json` doesn't set `ios.infoPlist.ITSAppUsesNonExemptEncryption`, so App Store Connect asks on every build. Subby encrypts user data itself (E2EE), so the plain "HTTPS only" exemption may not fit. That's the user's legal call: ask, don't answer it, then set the key in `app.json` so it stops asking.
- Push needs nothing: `apps/server/src/push/apns.ts` tries production APNs, then the sandbox.
- Purchases: TestFlight builds buy in the sandbox, so production must keep `APPLE_ALLOW_SANDBOX=1` while TestFlight is in use (R0).

## 5. After the upload
- Tag the bump commit and push the tag: `git tag -a android-<versionCode> -m "<version> (<track>)"` or `ios-<buildNumber>`.
- Note in `LAUNCH.md` what went where (ticket, track, number).
- If the Pixels or the iPad are next, they need a fresh dev-signed prebuild (`native-build`).

## Launch release only (the first production release)
Work through `LAUNCH.md` R0-R6 as written there; it's the source of truth. Easy to forget:
- R0: remove `APPLE_ALLOW_SANDBOX` on production, unless TestFlight or Xcode builds still buy.
- R5: "what's new" in all seven languages (A14), Play's limit is 500 characters.
- R6: the smoke test runs on the build the stores deliver, not a local one.
