# macOS signing and notarization

Use this setup for public DMG releases. Without Developer ID signing and Apple
notarization, macOS may report a downloaded app as damaged.

Updater signing and Apple signing are separate:

- `TAURI_SIGNING_*` authenticates in-app updates.
- Developer ID signing and notarization satisfy macOS Gatekeeper.

## One-time setup

1. Join the paid Apple Developer Program.
2. In Apple Developer Certificates, create a `Developer ID Application`
   certificate.
3. Download the `.cer` file and open it to install it in Keychain.
4. Confirm that macOS can find the identity:

```bash
security find-identity -v -p codesigning
```

The output should contain:

```text
Developer ID Application: Your Name (TEAM_ID)
```

## Notarization credentials

Create an App Store Connect API key under:

```text
App Store Connect -> Users and Access -> Integrations
```

Download its `AuthKey_XXXXXXXXXX.p8` file. Apple only allows downloading this
private key once, so keep a secure backup.

Keep the `.p8` contents in a file. Do not paste the private key into
`APPLE_API_KEY`; that variable is only the key ID.

```bash
mkdir -p ~/.apple
mv ~/Downloads/AuthKey_XXXXXXXXXX.p8 ~/.apple/
chmod 600 ~/.apple/AuthKey_XXXXXXXXXX.p8
```

If the `.p8` private key contents are pasted into chat, logs, shell history, or
any other shared place, treat the key as compromised: revoke that App Store
Connect API key and create a new one.

## Local release

Export the Apple signing, notarization, and updater-signing credentials:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"

export APPLE_API_ISSUER="issuer-uuid"
export APPLE_API_KEY="XXXXXXXXXX" # Key ID, not the .p8 contents
export APPLE_API_KEY_PATH="$HOME/.apple/AuthKey_XXXXXXXXXX.p8"

export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/type-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="updater-key-password"
```

Publish a new version:

```bash
scripts/release-local.sh 0.4.4 desktop
```

Use a version that has not already been published as a GitHub Release.

Tauri should sign `Type.app`, submit it to Apple, wait for notarization, staple
the ticket, and build the DMG and updater archive.

## Verify before publishing

Replace the version in the DMG path as needed:

```bash
codesign --verify --deep --strict --verbose=2 \
  src-tauri/target/release/bundle/macos/Type.app

spctl --assess --type execute --verbose=4 \
  src-tauri/target/release/bundle/macos/Type.app

xcrun stapler validate \
  src-tauri/target/release/bundle/dmg/Type_0.4.4_aarch64.dmg
```

`spctl` should report `accepted` and identify the app as notarized Developer ID
software.

## GitHub Actions

For CI, export the Developer ID certificate and private key from Keychain as a
password-protected `.p12`, then configure the Apple secrets referenced in
`.github/workflows/release.yml`:

- `APPLE_CERTIFICATE` - base64-encoded `.p12`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD` - an app-specific Apple ID password
- `APPLE_TEAM_ID`

The updater also requires:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## References

- [Tauri macOS code signing](https://v2.tauri.app/distribute/sign/macos/)
- [Apple notarization](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [Apple Developer ID](https://developer.apple.com/developer-id/)
