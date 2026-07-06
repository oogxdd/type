# RN app → TestFlight: handoff

Status as of 2026-07-07. Goal: build the **React Native (Expo SDK 57)** mobile
app and ship it to TestFlight as a **separate** app, side-by-side with the Tauri
app (`com.digital.type2` / "Type_") — not overwriting it.

## TL;DR

Everything is set up and wired. The **only blocker** is a Swift compiler
incompatibility between Expo SDK 57's source and the current **Xcode 26.1 / Swift 6**
toolchain. This is expected to be resolved by upgrading macOS + Xcode. After the
upgrade, the build should go through with the steps in "Resume after upgrade".

## Identifiers & credentials (already in place)

- **New bundle ID:** `com.typenotes.mobile` — registered in the Apple Developer
  portal via the App Store Connect API. bundleId resource id `9MD497C3MA`,
  team `Y377P5XKGJ`.
- **App Store Connect app record:** **"Type RN"** created for
  `com.typenotes.mobile` (SKU `typenotes-mobile-rn`, primary locale en-US).
  Confirmed visible via the API. (The Tauri app is a different record: "Type_" /
  `com.digital.type2`.)
- **ASC API key** (for `altool` upload and Xcode auto-provisioning):
  - Key ID: `W2Y52J5N33`
  - Issuer ID: `bd0c62da-fcbf-4770-a10d-2ee30da0963e`
  - Key file: `~/.appstoreconnect/private_keys/AuthKey_W2Y52J5N33.p8`
- **Signing:** automatic, team `Y377P5XKGJ`. `apps/mobile/ios/ExportOptions.plist`
  is written for `app-store-connect` export.

## What's done

1. `expo prebuild --platform ios` → `apps/mobile/ios/` native project generated
   (bundle id already `com.typenotes.mobile`, from `app.json`).
2. `pod install` completed. Workspace: `apps/mobile/ios/Type.xcworkspace`,
   scheme `Type`, `MARKETING_VERSION 1.0`, `CURRENT_PROJECT_VERSION 1`.
3. Signing + `ExportOptions.plist` prepared.
4. ASC bundle ID + app record created.

## The blocker (Xcode 26 / Swift 6)

`xcodebuild archive` fails compiling `node_modules/expo-modules-jsi` with, e.g.:

```
JavaScriptActor.swift: error: 'weak' must be a mutable variable, because it may change at runtime
```
The source declares `weak let runtime: JavaScriptRuntime?` inside classes/structs
that conform to `Sendable`. Under Xcode 26's Swift 6 compiler:

- `weak let ...` → hard error ("must be a mutable variable").
- Changing to `weak var ...` → different hard error:
  `stored property 'runtime' of 'Sendable'-conforming class ... is mutable`.

Setting the Expo pods to **Swift 5 language mode** + `SWIFT_STRICT_CONCURRENCY = minimal`
via a Podfile `post_install` hook did **not** help: explicit `: Sendable`
conformance is checked in every language mode, so the mutable-stored-property
error persists. => The real cause is Expo SDK 57's Swift source expecting a
different (newer) Swift toolchain than Xcode 26.1 ships. Upgrading Xcode should
fix it.

Workarounds tried and **reverted** (tree is clean now): hand-patching
`weak let`→`weak var` in `expo-modules-jsi` (reverted; node_modules restored via
`npm install`), and the Podfile Swift-5 override (removed).

## Resume after macOS + Xcode upgrade

1. **Mount the external SSD** (see "Offloaded dirs" — `node_modules`, `Pods`,
   `build`, Rust `target`/`src-tauri` are symlinked to `/Volumes/KINGSTON`).
   Nothing builds if it's unmounted.
2. Refresh native deps against the new toolchain:
   ```bash
   cd /Users/digital/Projects/type/app/apps/mobile
   npx expo prebuild --platform ios --clean   # regenerates ios/ cleanly
   cd ios && pod install
   ```
   (Re-copy `ExportOptions.plist` if `--clean` wipes it — content below.)
3. Archive (ASC key lets Xcode auto-create the distribution profile):
   ```bash
   cd /Users/digital/Projects/type/app/apps/mobile/ios
   xcodebuild -workspace Type.xcworkspace -scheme Type -configuration Release \
     -destination "generic/platform=iOS" -archivePath build/Type.xcarchive archive \
     DEVELOPMENT_TEAM=Y377P5XKGJ CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates \
     -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_W2Y52J5N33.p8 \
     -authenticationKeyID W2Y52J5N33 \
     -authenticationKeyIssuerID bd0c62da-fcbf-4770-a10d-2ee30da0963e
   ```
4. Export the `.ipa`:
   ```bash
   xcodebuild -exportArchive -archivePath build/Type.xcarchive \
     -exportOptionsPlist ExportOptions.plist -exportPath build/export \
     -allowProvisioningUpdates \
     -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_W2Y52J5N33.p8 \
     -authenticationKeyID W2Y52J5N33 \
     -authenticationKeyIssuerID bd0c62da-fcbf-4770-a10d-2ee30da0963e
   ```
5. Upload to the "Type RN" TestFlight app:
   ```bash
   xcrun altool --upload-app --type ios --file build/export/Type.ipa \
     --apiKey W2Y52J5N33 --apiIssuer bd0c62da-fcbf-4770-a10d-2ee30da0963e
   ```

If the same `expo-modules-jsi` Swift errors still appear after the upgrade, the
fallback is to bump `expo`/`expo-modules-*` to a version that supports the new
Xcode (check `npx expo install --fix` / Expo SDK release notes), or file it as an
Expo SDK 57 + Xcode issue.

### ExportOptions.plist (already at apps/mobile/ios/ExportOptions.plist)

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

## Offloaded dirs (freeing local disk)

Moved to the KINGSTON SSD and replaced with symlinks (restore by moving back or
keep the SSD mounted). Under `/Volumes/KINGSTON/type-offload/rn-app/`:

- `src-tauri` (11G), `target` (4.4G), `node_modules`, `apps/desktop/node_modules`,
  `apps/mobile/node_modules`, `apps/mobile/ios/Pods`, `apps/mobile/ios/build`.

The Tauri repo at `/private/tmp/type-app-main` was left untouched (its
`node_modules`/`target` were in use by another task).

## Sync-store change (already committed)

`apps/mobile/src/state/sync-store.ts` + `apps/desktop/.../use-git-sync-workflows.ts`
got the git auto-reconnect change — committed as `2115a9e` on
`feat/react-native-monorepo` (not pushed yet).
