# Local iOS TestFlight Build

Short runbook for this machine. Run commands from the repo root unless noted.

## Normal path, no clean prebuild

Use this when `apps/mobile/ios` is already current and only the build number or
Rust/mobile code changed.

1. Bump `apps/mobile/app.json` `expo.ios.buildNumber`.
2. Mirror that value in `apps/mobile/ios/Type/Info.plist` `CFBundleVersion`.
3. Run checks:

```sh
npm run typecheck -w @typenotes/mobile
npm run test -w @typenotes/mobile
```

4. Regenerate the iOS Rust core with a device slice:

```sh
IPHONEOS_DEPLOYMENT_TARGET=16.4 npm run codegen:ios:device -w @typenotes/mobile-core
```

5. Refresh pods without regenerating the native project:

```sh
cd apps/mobile/ios
pod install
```

Confirm `Pods/Target Support Files/Pods-Type/Pods-Type.release.xcconfig`
contains `-lz -liconv`. The `Podfile` post-install hook should add these; they
are required because `libtype_ffi.a` statically includes libgit2.

6. Archive:

```sh
xcodebuild -workspace Type.xcworkspace -scheme Type -configuration Release \
  -destination "generic/platform=iOS" -archivePath build/Type.xcarchive archive \
  DEVELOPMENT_TEAM=Y377P5XKGJ CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates \
  MARKETING_VERSION=0.1.0 CURRENT_PROJECT_VERSION=<build-number> \
  -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_W2Y52J5N33.p8 \
  -authenticationKeyID W2Y52J5N33 \
  -authenticationKeyIssuerID bd0c62da-fcbf-4770-a10d-2ee30da0963e
```

7. Export:

```sh
xcodebuild -exportArchive -archivePath build/Type.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/export \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_W2Y52J5N33.p8 \
  -authenticationKeyID W2Y52J5N33 \
  -authenticationKeyIssuerID bd0c62da-fcbf-4770-a10d-2ee30da0963e
```

8. Upload:

```sh
xcrun altool --upload-app --type ios --file build/export/Type.ipa \
  --apiKey W2Y52J5N33 --apiIssuer bd0c62da-fcbf-4770-a10d-2ee30da0963e
```

## When to use clean prebuild

Only use `npx expo prebuild --platform ios --clean` after changing Expo config,
plugins, native dependencies, or if the native project is badly stale. It rewrites
`apps/mobile/ios`, so inspect the diff afterward and preserve
`apps/mobile/ios/ExportOptions.plist`.
