# Native iOS GitHub Actions to TestFlight (without EAS)

This is the implementation runbook for replacing the EAS steps in
`.github/workflows/mobile-testflight.yml` with a native Xcode build and direct
App Store Connect upload.

It does **not** remove Expo from the application. `expo prebuild` is still used
to materialize the checked-in native project and the `RecordingWidget` target.
The archive, export, signing, and upload are performed by Apple tools on a
GitHub-hosted macOS runner; neither EAS Build nor EAS Submit is involved.

## Current repository state

The release trigger and version parsing already exist and can be kept:

- `mobile-vX.Y.Z` tags and manual dispatch trigger the workflow;
- `setup` derives `MOBILE_VERSION` and `IOS_BUILD_NUMBER`;
- `github-release` creates metadata without replacing the desktop release;
- `ios` runs on macOS, builds the Rust/UniFFI device slice, and runs Expo
  prebuild;
- the final two steps currently use `eas-cli build --local` and
  `eas-cli submit` and must be replaced.

Repository-specific values:

| Item | Value |
| --- | --- |
| App Store Connect app | `Type RN` |
| Main bundle ID | `com.typenotes.mobile` |
| Widget bundle ID | `com.typenotes.mobile.RecordingWidget` |
| Workspace | `apps/mobile/ios/Type.xcworkspace` |
| Shared scheme | `Type` |
| Export options | `apps/mobile/ios/ExportOptions.plist` |
| Apple team | `Y377P5XKGJ` |
| Minimum supported Xcode | 26.6; see `apps/mobile/TESTFLIGHT_HANDOFF.md` |

The repository currently has desktop Apple secrets, but no `EXPO_TOKEN` and no
App Store Connect API-key secrets. Do not assume the existing
`APPLE_CERTIFICATE` can sign iOS: it may be a Developer ID or Mac distribution
certificate used by the desktop release. Verify its type or create a dedicated
Apple Distribution certificate for mobile CI.

## Target flow

```text
mobile-vX.Y.Z tag / manual dispatch
  -> macos-26 runner + Xcode 26.6
  -> npm dependencies
  -> Rust device targets + UniFFI native module
  -> expo prebuild + CocoaPods
  -> temporary keychain + Apple Distribution identity
  -> xcodebuild archive
  -> xcodebuild exportArchive -> Type.ipa
  -> altool validate + upload with an App Store Connect API key
  -> Apple processing -> TestFlight
```

An upload places the build in App Store Connect for processing. It does not by
itself add the build to every tester group. Internal-group automatic
distribution can be configured in App Store Connect; external testing may also
require Beta App Review.

## 1. One-time Apple setup

### App and identifiers

Confirm all of the following in Apple Developer and App Store Connect:

1. Apple Developer Program membership is active and current agreements are
   accepted.
2. The `Type RN` App Store Connect record uses `com.typenotes.mobile`.
3. Explicit identifiers exist for both:
   - `com.typenotes.mobile`
   - `com.typenotes.mobile.RecordingWidget`
4. The app and widget capabilities match the generated Xcode project.

The widget is created by
`apps/mobile/modules/recording-activity/plugin/withRecordingActivity.js` during
`expo prebuild`. Signing only the main app is not enough; the embedded extension
must also be provisioned.

### App Store Connect API key

Create a **team** App Store Connect API key in App Store Connect -> Users and
Access -> Integrations. It is used for both Xcode automatic provisioning and
the upload.

Requirements:

- use an Account Holder/Admin-created team key, not an individual key;
- grant the smallest role that can upload builds and access the required
  Certificates, Identifiers & Profiles operations;
- download the `.p8` file immediately; Apple only allows it to be downloaded
  once;
- record the Key ID and Issuer ID;
- store the private key only as a GitHub secret, never in git.

An individual API key cannot use provisioning endpoints, so it is not suitable
for the automatic-signing approach below.

### Apple Distribution certificate

Create or reuse a valid **Apple Distribution** certificate that belongs to team
`Y377P5XKGJ`, install it together with its private key on a trusted Mac, and
export the identity from Keychain Access as a password-protected `.p12`.

The API key authenticates provisioning and uploading; the distribution
certificate/private key performs code signing. A `.cer` file by itself is not
enough because it does not contain the private key.

This runbook deliberately imports a stable distribution identity on each
ephemeral runner and lets Xcode automatically create/download the matching App
Store profiles. It avoids creating a new signing certificate on every run.

## 2. GitHub environment and secrets

Create a `testflight` GitHub Environment. A required reviewer is recommended so
a pushed release tag cannot use Apple credentials until a human approves the
job. If unattended releases are intentional, omit the reviewer but keep the job
restricted to the existing tag/manual triggers.

Add these secrets at the environment or repository level:

| Secret | Contents |
| --- | --- |
| `APPLE_TEAM_ID` | `Y377P5XKGJ` (already present at repository level) |
| `IOS_DISTRIBUTION_CERTIFICATE` | Base64-encoded Apple Distribution `.p12` |
| `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` |
| `APP_STORE_CONNECT_KEY_ID` | Team API key ID |
| `APP_STORE_CONNECT_ISSUER_ID` | Team API key issuer ID |
| `APP_STORE_CONNECT_PRIVATE_KEY` | Complete contents of `AuthKey_<KEY_ID>.p8` |

Use dedicated iOS secret names instead of silently reusing the desktop
`APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD`.

Example setup from a trusted Mac, with values supplied through stdin so they do
not appear as CLI arguments:

```sh
base64 < /secure/path/Type-Apple-Distribution.p12 \
  | gh secret set IOS_DISTRIBUTION_CERTIFICATE --repo oogxdd/type

printf '%s' '<p12-password>' \
  | gh secret set IOS_DISTRIBUTION_CERTIFICATE_PASSWORD --repo oogxdd/type

printf '%s' '<key-id>' \
  | gh secret set APP_STORE_CONNECT_KEY_ID --repo oogxdd/type

printf '%s' '<issuer-id>' \
  | gh secret set APP_STORE_CONNECT_ISSUER_ID --repo oogxdd/type

gh secret set APP_STORE_CONNECT_PRIVATE_KEY --repo oogxdd/type \
  < /secure/path/AuthKey_<KEY_ID>.p8
```

Prefer entering short values interactively instead of leaving real values in
shell history. After setup, `gh secret list --repo oogxdd/type` should show the
names and timestamps, never the secret contents.

`EXPO_TOKEN` is not needed after the native workflow is enabled.

## 3. Replace the EAS portion of the workflow

Keep the current `setup` and `github-release` jobs. Replace the `ios` job with
the following shape. The snippet uses only the existing actions plus native
Apple command-line tools.

```yaml
  ios:
    needs: setup
    runs-on: macos-26
    timeout-minutes: 180
    environment: testflight
    permissions:
      contents: read
    env:
      APP_VARIANT: production
      MOBILE_VERSION: ${{ needs.setup.outputs.version }}
      IOS_BUILD_NUMBER: ${{ needs.setup.outputs.build_number }}
      APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
      IOS_DISTRIBUTION_CERTIFICATE: ${{ secrets.IOS_DISTRIBUTION_CERTIFICATE }}
      IOS_DISTRIBUTION_CERTIFICATE_PASSWORD: ${{ secrets.IOS_DISTRIBUTION_CERTIFICATE_PASSWORD }}
      APP_STORE_CONNECT_KEY_ID: ${{ secrets.APP_STORE_CONNECT_KEY_ID }}
      APP_STORE_CONNECT_ISSUER_ID: ${{ secrets.APP_STORE_CONNECT_ISSUER_ID }}
      APP_STORE_CONNECT_PRIVATE_KEY: ${{ secrets.APP_STORE_CONNECT_PRIVATE_KEY }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Select Xcode 26.6
        run: |
          sudo xcode-select -s /Applications/Xcode_26.6.app/Contents/Developer
          xcodebuild -version

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-ios,aarch64-apple-ios-sim,x86_64-apple-ios

      - uses: swatinem/rust-cache@v2

      - name: Verify required secrets
        run: |
          set -euo pipefail
          for name in \
            APPLE_TEAM_ID \
            IOS_DISTRIBUTION_CERTIFICATE \
            IOS_DISTRIBUTION_CERTIFICATE_PASSWORD \
            APP_STORE_CONNECT_KEY_ID \
            APP_STORE_CONNECT_ISSUER_ID \
            APP_STORE_CONNECT_PRIVATE_KEY
          do
            [ -n "${!name:-}" ] || {
              echo "Missing required secret: $name" >&2
              exit 1
            }
          done

      - name: Install dependencies
        run: npm ci

      - name: Check mobile code
        run: |
          npm run typecheck -w @typenotes/mobile
          npm run test -w @typenotes/mobile

      - name: Generate iOS native core
        run: npm run --workspace @typenotes/mobile-core codegen:ios:device

      - name: Sync Expo native project
        working-directory: apps/mobile
        run: npx expo prebuild --platform ios

      - name: Install iOS pods
        working-directory: apps/mobile
        run: npx pod-install ios

      - name: Install Apple signing credentials
        run: |
          set -euo pipefail

          CERTIFICATE_PATH="$RUNNER_TEMP/ios-distribution.p12"
          KEYCHAIN_PATH="$RUNNER_TEMP/ios-signing.keychain-db"
          KEYCHAIN_PASSWORD="$(openssl rand -base64 32)"
          ASC_KEY_DIR="$HOME/.appstoreconnect/private_keys"
          ASC_KEY_PATH="$ASC_KEY_DIR/AuthKey_${APP_STORE_CONNECT_KEY_ID}.p8"

          echo "::add-mask::$KEYCHAIN_PASSWORD"
          printf '%s' "$IOS_DISTRIBUTION_CERTIFICATE" \
            | base64 --decode > "$CERTIFICATE_PATH"
          mkdir -p "$ASC_KEY_DIR"
          printf '%s' "$APP_STORE_CONNECT_PRIVATE_KEY" > "$ASC_KEY_PATH"
          chmod 600 "$CERTIFICATE_PATH" "$ASC_KEY_PATH"

          security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          security import "$CERTIFICATE_PATH" \
            -P "$IOS_DISTRIBUTION_CERTIFICATE_PASSWORD" \
            -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
          security set-key-partition-list \
            -S apple-tool:,apple: \
            -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          security list-keychains -d user -s "$KEYCHAIN_PATH"
          security default-keychain -d user -s "$KEYCHAIN_PATH"
          security find-identity -v -p codesigning "$KEYCHAIN_PATH"

          echo "SIGNING_KEYCHAIN_PATH=$KEYCHAIN_PATH" >> "$GITHUB_ENV"
          echo "ASC_KEY_PATH=$ASC_KEY_PATH" >> "$GITHUB_ENV"

      - name: Archive iOS app
        working-directory: apps/mobile/ios
        run: |
          set -euo pipefail
          xcodebuild \
            -workspace Type.xcworkspace \
            -scheme Type \
            -configuration Release \
            -destination "generic/platform=iOS" \
            -archivePath "$RUNNER_TEMP/Type.xcarchive" \
            archive \
            DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
            CODE_SIGN_STYLE=Automatic \
            MARKETING_VERSION="$MOBILE_VERSION" \
            CURRENT_PROJECT_VERSION="$IOS_BUILD_NUMBER" \
            OTHER_CODE_SIGN_FLAGS="--keychain $SIGNING_KEYCHAIN_PATH" \
            -allowProvisioningUpdates \
            -authenticationKeyPath "$ASC_KEY_PATH" \
            -authenticationKeyID "$APP_STORE_CONNECT_KEY_ID" \
            -authenticationKeyIssuerID "$APP_STORE_CONNECT_ISSUER_ID"

      - name: Export IPA
        working-directory: apps/mobile/ios
        run: |
          set -euo pipefail
          xcodebuild \
            -exportArchive \
            -archivePath "$RUNNER_TEMP/Type.xcarchive" \
            -exportOptionsPlist ExportOptions.plist \
            -exportPath "$RUNNER_TEMP/type-export" \
            -allowProvisioningUpdates \
            -authenticationKeyPath "$ASC_KEY_PATH" \
            -authenticationKeyID "$APP_STORE_CONNECT_KEY_ID" \
            -authenticationKeyIssuerID "$APP_STORE_CONNECT_ISSUER_ID"
          test -f "$RUNNER_TEMP/type-export/Type.ipa"

      - name: Validate IPA with App Store Connect
        run: |
          xcrun altool --validate-app \
            --type ios \
            --file "$RUNNER_TEMP/type-export/Type.ipa" \
            --apiKey "$APP_STORE_CONNECT_KEY_ID" \
            --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID"

      - name: Upload to TestFlight
        run: |
          xcrun altool --upload-app \
            --type ios \
            --file "$RUNNER_TEMP/type-export/Type.ipa" \
            --apiKey "$APP_STORE_CONNECT_KEY_ID" \
            --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID"

      - name: Upload IPA artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: type-ios-${{ needs.setup.outputs.tag }}
          path: ${{ runner.temp }}/type-export/Type.ipa
          if-no-files-found: ignore

      - name: Remove temporary keychain
        if: always()
        run: |
          if [ -n "${SIGNING_KEYCHAIN_PATH:-}" ]; then
            security delete-keychain "$SIGNING_KEYCHAIN_PATH" || true
          fi
```

### Why automatic signing is retained

`apps/mobile/ios/ExportOptions.plist` already has `signingStyle=automatic` and
the correct team. Keeping automatic signing lets Xcode resolve separate App
Store provisioning profiles for the app and generated widget target. The
stable `.p12` identity supplies the private key; the App Store Connect team key
allows `xcodebuild -allowProvisioningUpdates` to create or download profiles.

If the team policy forbids provisioning access for the CI API key, use manual
signing instead. That requires two App Store provisioning profiles, one for each
bundle ID, and an export options plist containing a `provisioningProfiles` map.
Do not solve that case by applying the main app profile to the widget.

## 4. Build-number behavior

The existing workflow uses `github.run_number` unless manual dispatch supplies
`build_number`. Apple identifies a build by bundle ID, marketing version, and
build string, so the combination must be unique.

- A new `mobile-vX.Y.Z` version can use a lower build number than a previous
  marketing version.
- Releasing the same version again needs a different build number.
- A re-run of the same GitHub workflow run reuses `github.run_number`; use a new
  manual dispatch with an explicit build number if the previous upload reached
  Apple.
- Keep the value numeric; the current repository convention is date-based when
  a human supplies it.

The archive command intentionally overrides both `MARKETING_VERSION` and
`CURRENT_PROJECT_VERSION` because Expo prebuild may leave template values in
the generated Xcode project.

## 5. Safe rollout

1. Confirm the app and widget identifiers and create the team API key.
2. Export a dedicated Apple Distribution `.p12` and add all six GitHub secrets.
3. Add the `testflight` environment and optional reviewer protection.
4. Change `.github/workflows/mobile-testflight.yml` in a separate implementation
   PR using the native job above.
5. Before the first upload, compare `xcodebuild -showBuildSettings` after
   prebuild and confirm both targets use team `Y377P5XKGJ` and their intended
   bundle IDs.
6. Merge the workflow change to `main`, then use manual dispatch with an
   explicit version/build number for the first native release.
7. In the Actions log, verify:
   - Xcode 26.6 was selected;
   - an `Apple Distribution` signing identity was found;
   - the archive contains both `Type.app` and `RecordingWidget.appex`;
   - validation and upload return success.
8. In App Store Connect -> TestFlight -> Build Uploads, wait for processing to
   complete and inspect warnings before enabling tag-only unattended releases.
9. Remove `EXPO_TOKEN` from GitHub/EAS only after one native upload succeeds.
   `eas.json` may remain for local fallback or be deleted in a later cleanup.

## Common failures

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| No signing certificate found | `.p12` lacks its private key or is not Apple Distribution | Re-export the identity from Keychain Access and verify the password |
| Provisioning profile not found | API key cannot access provisioning or an identifier is missing | Use a team key with provisioning access and register both bundle IDs |
| Widget signing failure | Only the main app identifier/profile exists | Provision `com.typenotes.mobile.RecordingWidget` too |
| `expo-modules-jsi` compile error | Wrong Xcode selected | Confirm `/Applications/Xcode_26.6.app` and `xcodebuild -version` |
| Undefined `crc32`, `iconv`, or zlib symbols | CocoaPods post-install flags were not applied | Confirm the generated `Pods-Type.release.xcconfig` includes `-lz -liconv` |
| Duplicate build | The version/build pair already reached Apple | Dispatch a new run with a different numeric build number |
| Build uploaded but absent in TestFlight | Apple is still processing it or processing failed | Check App Store Connect -> Build Uploads and the delivery log |
| Missing compliance prompt | Export-compliance metadata drifted | Confirm `ITSAppUsesNonExemptEncryption=false` remains in the built app |

## Official references

- [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [GitHub macOS 26 runner image and installed Xcode versions](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md)
- [GitHub Actions secrets](https://docs.github.com/en/actions/concepts/security/secrets)
- [Creating App Store Connect API keys](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api)
- [Apple signing certificate overview](https://developer.apple.com/help/account/create-certificates/certificates-overview)
- [Distributing apps for beta testing and releases](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases)
- [Uploading builds to App Store Connect](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
- [`CFBundleVersion` format](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleversion)
