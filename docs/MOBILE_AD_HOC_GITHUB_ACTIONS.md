# Native iOS ad-hoc releases from GitHub Actions

This is the operations runbook for
`.github/workflows/mobile-adhoc.yml`. GitHub Actions builds and signs the native
iOS app; Expo/EAS and TestFlight are not part of the release path.

## Release flow

```text
mobile-vX.Y.Z tag / manual dispatch
  -> macos-26 runner + Xcode 26.6
  -> npm checks + Rust/UniFFI device framework
  -> Expo prebuild + CocoaPods
  -> Xcode archive + release-testing (ad-hoc) export
  -> signature, version, and registered-device verification
  -> retained GitHub Actions artifact
  -> production deployment at https://type-ota.vercel.app
  -> tagged builds also attach Type.ipa to a GitHub Release
```

Only UDIDs embedded in the exported provisioning profile can install the app.
The workflow checks every UDID configured in `IOS_AD_HOC_DEVICE_UDIDS` before it
deploys anything.

## One-time Apple setup

1. Register each target iPhone/iPad in the Apple Developer portal.
2. Keep explicit identifiers for `com.typenotes.mobile` and
   `com.typenotes.mobile.RecordingWidget`.
3. Use a team App Store Connect API key that can manage signing assets.
4. Export the Apple Distribution identity used by the working local ad-hoc
   build from Keychain Access as a password-protected `.p12`. The export must
   include its private key.

The API key lets Xcode create/fetch ad-hoc provisioning profiles. Unlike the
App Store export, an ad-hoc build also needs the Apple Distribution private key
on the ephemeral runner, which is why CI imports the `.p12` into a temporary
keychain.

## GitHub environment, secrets, and variables

The job deliberately keeps using the existing `testflight` GitHub Environment
so its configured Apple API-key secrets do not need to be copied. The name is
legacy; the workflow does not contact TestFlight. Add these environment (or
repository) secrets:

| Secret | Contents |
| --- | --- |
| `APPLE_TEAM_ID` | Apple Developer team ID (`Y377P5XKGJ`) |
| `APP_STORE_CONNECT_KEY_ID` | Team API key ID |
| `APP_STORE_CONNECT_ISSUER_ID` | Team API key issuer ID |
| `APP_STORE_CONNECT_PRIVATE_KEY` | Complete `AuthKey_<KEY_ID>.p8` contents |
| `IOS_DISTRIBUTION_CERTIFICATE_BASE64` | Base64 of the password-protected `.p12` |
| `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` |
| `IOS_AD_HOC_DEVICE_UDIDS` | Required UDIDs, separated by commas, spaces, or newlines |
| `VERCEL_TOKEN` | Vercel access token allowed to deploy `type-ota` |

The existing Vercel org/project IDs are defaults in the workflow because they
are identifiers, not credentials. Optionally override these repository
variables if the site moves:

| Variable | Contents |
| --- | --- |
| `IOS_AD_HOC_BASE_URL` | Optional; defaults to `https://type-ota.vercel.app` |
| `VERCEL_ORG_ID` | Optional override for the Vercel account/team ID |
| `VERCEL_PROJECT_ID` | Optional override for the Vercel project ID |

Generate the certificate value without putting binary data in the shell
history:

```sh
base64 -i /secure/path/Type-AdHoc-Distribution.p12 \
  | gh secret set IOS_DISTRIBUTION_CERTIFICATE_BASE64 \
      --env testflight --repo oogxdd/type
gh secret set IOS_DISTRIBUTION_CERTIFICATE_PASSWORD \
  --env testflight --repo oogxdd/type
```

The second command prompts for the password. Configure the other values in the
GitHub UI or with `gh secret set` / `gh variable set`. Vercel shows the org and
project IDs in the project's settings; its CLI also writes them to
`.vercel/project.json` after `vercel link`.

## Cutting a release

For a tagged release from `main`:

```sh
git switch main
git pull --ff-only
git tag mobile-v0.2.7
git push origin mobile-v0.2.7
```

A tag publishes the OTA site and creates a GitHub Release containing `Type.ipa`.
For a controlled first run, use Actions -> **Mobile Ad Hoc** -> **Run workflow**
from `main`. A manual run deploys the OTA site and retains a 30-day Actions
artifact, but does not create a GitHub Release because no matching tag exists.

The default build number is `github.run_number`. Supply a different numeric
build number on a manual run if needed.

## Installation and data warning

Open `https://type-ota.vercel.app` in Safari on a registered device and tap
Install. Other browsers do not handle the `itms-services` link.

An ad-hoc build and a TestFlight/App Store build of the same bundle ID cannot be
installed over one another. Deleting the old app deletes its local container,
including notes, settings, and its SSH key, so sync the phone first.

## Verification performed by CI

Before deploying, the workflow verifies:

- the generated package points at the native UniFFI core rather than demo mode;
- the IPA exists and its signature passes `codesign --verify`;
- bundle ID, version, and build number match the release inputs;
- every configured UDID appears in the app and widget provisioning profiles;
- the deployed manifest points to the production IPA and contains the version;
- the production landing page, manifest, and IPA are reachable.

The GitHub-hosted runner deletes its temporary keychain, `.p12`, and API key at
the end of the job even when a step fails.

## Common failures

| Symptom | Likely cause / fix |
| --- | --- |
| No Apple Distribution identity | Re-export the `.p12` with its private key and update both certificate secrets |
| Xcode cannot create an ad-hoc profile | Check API-key permissions, both bundle identifiers, registered devices, and current Apple agreements |
| Configured device is absent from the profile | Register its UDID in Apple Developer and let Xcode regenerate the profile |
| Widget signing failure | Register/provision `com.typenotes.mobile.RecordingWidget` too |
| Vercel deployment succeeds but installation page is protected | Disable Deployment Protection for the public production site |
| Install starts and then fails | Remove a differently signed copy of the same bundle ID and confirm the device UDID |

For local signing diagnostics and cable installation, see
[`apps/mobile/AD_HOC_DISTRIBUTION.md`](../apps/mobile/AD_HOC_DISTRIBUTION.md).

## Local release 0.4.3 (2026-10-03)

iOS 0.4.3, build `2026100301`, was built locally from source commit
`809eef31` with the version updates in `apps/mobile/app.json` and the native
app's `Info.plist`. No CI build or tag push was needed. The optimized Rust
device/simulator framework was regenerated, CocoaPods refreshed, and Xcode
26.6 successfully archived and exported an Apple Distribution signed ad-hoc IPA.
The existing `EXPO_USE_PRECOMPILED_MODULES: false` setting was preserved.

Validation: mobile typecheck, 142 mobile tests, 9 mobile bridge tests and 94
shared-core tests passed. The core sync tests required execution outside the
sandbox to bind synthetic local sockets. The IPA passed deep/strict codesign
verification. App and RecordingWidget versions/builds match, both profiles
contain all three devices supported by the previously deployed 0.4.2 IPA,
and neither permits debugging. Physical-device installation and UI feel remain
for user testing; Android was not built.

Local artifacts (ignored by Git):

- `apps/mobile/ios/build/export-adhoc-0.4.3/Type.ipa`
- `apps/mobile/ios/build/Type-0.4.3.xcarchive`
- `apps/mobile/ios/build/ota-0.4.3/` (install page, manifest and IPA)
- `apps/mobile/ios/build/release-0.4.3/` (build logs and verification metadata)

IPA SHA-256: `07a2abba5e8a0358f089d372d6282cc372c78fc6cf7f38303cdfe33cb2451219`.
Published to the existing `https://type-ota.vercel.app` site after explicit user
approval. The live landing page, manifest and IPA returned HTTP 200 with their
expected content types; the manifest reports 0.4.3 and the downloaded production
IPA matches the verified local SHA-256. No GitHub release or tag was created.

## Local release 0.4.4 (2026-10-04)

Built locally and published to `https://type-ota.vercel.app` from requested
commit `41b03e8eded636438226e584b684268148dd4d9b`, with only release version
metadata changed to 0.4.4 / build `2026100302`. This includes the note-loading
and worker-based feed-processing changes. Regenerated the optimized Rust
device/simulator framework and UniFFI bindings, refreshed CocoaPods without
enabling precompiled Expo modules, and archived/exported with Xcode 26.6.

Mobile and generated-bridge typechecks passed. All 343 functional tests passed:
160 mobile (including worker serialization), 9 bridge, 77 shared, 96 core and
one FFI end-to-end flow. The exported IPA passed deep/strict signature checking
and is signed by Apple Distribution. App/widget versions and build numbers
match; both profiles retain all three previously supported devices and disable
debugging. Live page, manifest and IPA returned HTTP 200 with correct content
types; the downloaded production IPA matches the local SHA-256.

Artifacts and logs use the same paths as 0.4.3 above with `0.4.4` substituted.
IPA SHA-256: `eb14535d4f919f8c3cbd1700b76732db3cda2f42e3568f8a49550c2e394f30ee`.
Physical-device installation/UI feel remain for user testing; Android was not
built. No GitHub release or tag was created.

## Local release 0.4.5 (2026-10-06)

Built locally and published to `https://type-ota.vercel.app` from release source
commit `55ee28f8047bbbb3a8d908c693279028e62a9127`. Main's integrated mobile runtime,
conditional-save/media FFI and incremental sync work are included, together with
explicitly requested recording commit `433b8814` (merged as `a8a984ad`). Version
metadata is committed as `55ee28f8`: iOS 0.4.5, build `2026100601`.

The recording changes include prepared native capture, immediate Stop feedback,
independent durable imports, a workspace-pinned recovery journal, background
import tasks and interrupted iOS PCM WAV recovery. Regenerated optimized Rust
device/simulator slices and UniFFI bindings, refreshed CocoaPods to compile
`RecordingRecovery.swift`, and archived/exported with Xcode 26.6. Used the
versioned native customizations and kept `EXPO_USE_PRECOMPILED_MODULES: false`;
prebuild's unrelated project changes were restored. Pod versions stayed the
same. Shared dependency paths and Metro watch folders were adjusted only in the
isolated build checkout, recorded in its `native-build.diff`, and restored after
packaging. Generated package-root bindings are retained with release evidence,
while the committed clean-clone fallback is restored.

Mobile and generated-bridge typechecks passed. All **289 TypeScript functional
tests** passed: 202 mobile, 10 bridge and 77 shared. The standalone Swift suite
passed real Core Audio WAV repair after process death, padded chunks, incomplete
frames, repeated repair and invalid/empty-file retention. The core/FFI source
trees are identical to the integrated main tree already verified by 108 core
tests and the FFI end-to-end flow; those unchanged suites were not repeated.

The exported IPA passed deep/strict signature verification and is signed by
Apple Distribution. App/widget versions and builds agree, both profiles retain
all three devices from 0.4.4, and both disable debugging. Embedded Expo config
has background recording enabled. Live page, manifest and IPA returned HTTP 200
with the expected content types; the production IPA matches the local SHA-256.

Build artifacts and logs are under
`.worktrees/mobile-release-0.4.5/apps/mobile/ios/build/`:

- `Type-0.4.5.xcarchive`
- `export-adhoc-0.4.5/Type.ipa`
- `ota-0.4.5/`
- `release-0.4.5/` (source, logs, native build diff and local/live verification)

IPA size: `23461994` bytes.
SHA-256: `f3d86086eb2ea6efa2dfee6e3a8fcecc3b81bd9c0616f0528cbc7454b95ed580`.
To make room, regenerable Type Debug simulator build products were removed;
the existing Type DerivedData cache was moved to
`apps/mobile/ios/DerivedData/Type-mobile-local`, retaining its former Xcode path
through a symlink. Existing release artifacts and installed-app data remain.

Physical-device installation, recording through shutdown/background expiration,
real phone-to-desktop sync timing and UI feel remain for user testing. Android
was not built. No CI build, GitHub release or tag was created.
