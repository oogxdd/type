# Local iOS / TestFlight upload

This is the local flow for building an iOS `.ipa` and uploading it to App Store
Connect so it appears in TestFlight.

## Prerequisites

- Apple Developer Program membership
- An app record already created in App Store Connect
- A valid iOS distribution certificate and provisioning profile
- An App Store Connect API key
- Xcode and Tauri iOS setup already initialized

## Environment

Set these variables before upload:

```bash
export APPLE_ASC_API_KEY_ID="KEY_ID"
export APPLE_ASC_API_ISSUER_ID="ISSUER_UUID"
export TAURI_IOS_BUILD_NUMBER="$(date +%s)"
```

`APPLE_ASC_API_KEY_ID` is the key ID, not the `.p8` contents.

Put the private key file where `altool` expects it:

```text
~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
```

If you need to move the file there:

```bash
mkdir -p ~/.appstoreconnect/private_keys
mv ~/Downloads/AuthKey_<KEY_ID>.p8 ~/.appstoreconnect/private_keys/
chmod 600 ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
```

## Build

```bash
npm run ios:build
```

This wraps `tauri ios build -- --export-method app-store-connect` and emits an
`.ipa` under `src-tauri/gen/apple/build/...`.

## Upload

```bash
npm run ios:push
```

The script finds the built `.ipa` automatically and uploads it with `altool`.

## Notes

- Each upload needs a unique build number.
- App Store Connect uses the bundle ID, version, and build string to identify
  builds.
- After upload, Apple processes the build before it appears in the TestFlight
  tab.

