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
