---
name: native-build
description: Build and install Subby's native Android/iOS apps locally (no EAS) - dev builds, release APKs, LAN-server builds, iOS on a physical device, testing background tasks (store builds: the `release` skill). Use when building, prebuilding, installing on a phone or emulator, or when a native change (new native package, app.json plugin, config plugin) needs a rebuild.
---

# Native builds (local, no EAS)

- `expo-dev-client` is installed, so `pnpm run dev` / `expo start` targets the **Subby dev build**. Use `pnpm --filter @subby/mobile dev:go` (or press `s`) for Expo Go.
- `android/` and `ios/` are generated (Continuous Native Generation) and gitignored. Never edit them: change `app.json` or a config plugin instead.
- Build and install on a USB-connected phone or an emulator: `cd apps/mobile && pnpm android`. After native changes (new native package, `app.json` plugins), run `pnpm android:clean`.
- Rebuild only for native changes; JS changes hot-reload as usual.

## Android release builds
- **Release builds don't notice changes in `packages/shared` alone**: Gradle's JS bundle task only watches the app, so after a shared-only change run `./gradlew :app:createBundleReleaseJsAndAssets --rerun` first (or the APK ships the old bundle).
- `./gradlew assembleRelease`: Gradle runs the Expo CLI directly, without pnpm's `NODE_PATH`, so Babel resolves presets from `apps/mobile/node_modules`. That's why `babel-preset-expo` and `@babel/plugin-transform-react-jsx` (named by NativeWind's preset) are direct devDependencies; keep them.
- **Standalone builds for a LAN server**: `app.config.js` adds `usesCleartextTraffic` (via `expo-build-properties`) only when `SUBBY_ALLOW_HTTP=1` is set during prebuild:
  `SUBBY_ALLOW_HTTP=1 npx expo prebuild --clean --platform android && (cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a)`
- **Signing:** release APKs are signed with the debug key unless `SUBBY_SIGNING=/path/to/upload.properties` is set during prebuild (`plugins/withReleaseSigning.js`: Gradle reads `storeFile`, `storePassword`, `keyAlias`, `keyPassword` from that file at build time; keystore and file live outside the repo). Debug-signed release APKs install over the dev build and keep the data; upload-signed ones don't.
- **Store builds** (upload key, version bump, artifact checks): the `release` skill.

## iOS on a device
Team `L33LRKM2NX`, automatic signing.
- `npx expo run:ios --device` can't register a new device or create its profile. For a new device, build once with:
  `cd ios && xcodebuild -workspace Subby.xcworkspace -scheme Subby -configuration Debug -destination 'id=<udid>' -allowProvisioningUpdates -allowProvisioningDeviceRegistration -derivedDataPath build build`
  then `xcrun devicectl device install app --device <udid> build/Build/Products/Debug-iphoneos/Subby.app`.
- The device needs Developer Mode, and no Apple ID. "Unable to verify app" after an iPadOS update went away with an uninstall and reinstall.
- iOS keeps Keychain items (SecureStore) across an uninstall: turn sync off before deleting the app, or the reinstall comes back with the old sync identity.

## Background tasks
Background tasks don't run headless in dev-client builds (the headless runtime can't load the bundle from Metro). Test them in a release build. Release builds block `http://`, so test against an https server, or temporarily allow cleartext in the generated manifest.

## Toolchain (Android)
JDK 17, Android SDK 36, build-tools 36.0.0, NDK 27.1.12297006 (Gradle fetches the NDK). `JAVA_HOME` and `ANDROID_HOME` must be set.
