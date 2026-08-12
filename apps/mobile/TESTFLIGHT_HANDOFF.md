# RN app → TestFlight release guide

How to cut a TestFlight build of the **React Native (Expo SDK 57)** mobile app.
It ships as a **separate** App Store Connect app (`com.typenotes.mobile` /
"Type RN"), side-by-side with the Tauri desktop app (`com.digital.type2` /
"Type_") — not overwriting it.

First shipped: build `2026070702` (v0.1.0), uploaded 2026-07-07 on Xcode 26.6.
The earlier Xcode 26.1 / Swift 6 `expo-modules-jsi` compile error is resolved by
the toolchain (Xcode ≥ 26.6); no source patches are needed.

## Identifiers & credentials

- **Bundle ID:** `com.typenotes.mobile` (Apple Developer portal resource id
  `9MD497C3MA`, team `Y377P5XKGJ`). Set in `app.json` → `ios.bundleIdentifier`.
- **App Store Connect app record:** **"Type RN"** (SKU `typenotes-mobile-rn`,
  primary locale en-US).
- **ASC API key** (for `altool` upload + Xcode auto-provisioning):
  - Key ID: `W2Y52J5N33`
  - Issuer ID: `bd0c62da-fcbf-4770-a10d-2ee30da0963e`
  - Key file: `~/.appstoreconnect/private_keys/AuthKey_W2Y52J5N33.p8`
- **Signing:** automatic, team `Y377P5XKGJ`.
  `apps/mobile/ExportOptions.plist` is kept outside generated `ios/` and is
  written for `app-store-connect` export.
- **Export compliance** is pre-answered in config (`ITSAppUsesNonExemptEncryption`
  in `app.json`), so uploads don't prompt the encryption questionnaire — see
  `EXPORT_COMPLIANCE.md`.

## Release steps

Run from `apps/mobile/`. Prerequisites: `npm install` at the repo root, and the
Rust core xcframework generated with a **device** slice
(`IPHONEOS_DEPLOYMENT_TARGET=16.4 npm run codegen:ios:device` in
`packages/mobile-core` — `codegen:ios` is `--sim-only` and will not link for a
device/TestFlight build). Before archiving, confirm `src/index.tsx` is the
generated UniFFI entry and does not contain `__isDemoCore`.

1. **Bump the build number** in `app.json` → `ios.buildNumber` (must be unique
   per TestFlight upload; we use a date-based `YYYYMMDDNN`). Bump `version` for a
   new marketing version.

2. **Align deps + regenerate the native project.** `--clean` wipes `ios/`, but
   the export options plist is deliberately stored one level above it:
   ```bash
   npx expo install --fix
   npx expo prebuild --platform ios --clean   # runs pod install
   ```
   Verify the regenerated `ios/Type/Info.plist` has the camera / mic / speech
   permissions and the `type2` URL scheme, and `ios/Podfile.lock` includes
   `ExpoCamera`, `ExpoSpeechRecognition`, `ExpoAudio`.

   Note: Expo prebuild currently emits template defaults (`MARKETING_VERSION 1.0`,
   `CURRENT_PROJECT_VERSION 1`) into the pbxproj instead of the `app.json`
   values, so pass the intended values as build settings in the archive step
   below rather than trusting the pbxproj.

3. **Archive** (the ASC key lets Xcode auto-create the distribution profile):
   ```bash
   cd ios
   xcodebuild -workspace Type.xcworkspace -scheme Type -configuration Release \
     -destination "generic/platform=iOS" -archivePath build/Type.xcarchive archive \
     DEVELOPMENT_TEAM=Y377P5XKGJ CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates \
     MARKETING_VERSION=0.1.0 CURRENT_PROJECT_VERSION=2026070702 \
     -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_W2Y52J5N33.p8 \
     -authenticationKeyID W2Y52J5N33 \
     -authenticationKeyIssuerID bd0c62da-fcbf-4770-a10d-2ee30da0963e
   ```

4. **Export the `.ipa`:**
   ```bash
   xcodebuild -exportArchive -archivePath build/Type.xcarchive \
     -exportOptionsPlist ../ExportOptions.plist -exportPath build/export \
     -allowProvisioningUpdates \
     -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_W2Y52J5N33.p8 \
     -authenticationKeyID W2Y52J5N33 \
     -authenticationKeyIssuerID bd0c62da-fcbf-4770-a10d-2ee30da0963e
   ```

5. **Upload to TestFlight:**
   ```bash
   xcrun altool --upload-app --type ios --file build/export/Type.ipa \
     --apiKey W2Y52J5N33 --apiIssuer bd0c62da-fcbf-4770-a10d-2ee30da0963e
   ```

### ExportOptions.plist (git-tracked at `apps/mobile/ExportOptions.plist`)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>Y377P5XKGJ</string>
  <key>signingStyle</key><string>automatic</string>
  <key>destination</key><string>export</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
```
