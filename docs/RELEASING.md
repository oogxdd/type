# Native desktop releases

GPUI uses [Sparkle 2](https://sparkle-project.org/documentation/) on macOS,
with a universal Apple Silicon / Intel DMG, Developer ID signing,
notarization, Ed25519 archive signatures and a signed appcast. Requires macOS 12+.
The release path never falls back to shipping an unsigned artifact.

Settings → Updates provides manual checks and a device-local automatic-check
toggle. Automatic checks are enabled in configured release builds; installation
requires confirmation. Sparkle handles download, signature validation, app
replacement and relaunch. Before a check or relaunch, the shell flushes notes;
save conflicts, recordings and unfinished operations postpone relaunch. Resolve
the problem and use Check for updates again to resume. GPUI's normal quit hook
also preserves drafts if termination cannot be cancelled.

Dev bundles and standalone binaries never start Sparkle. A plain
`npm run desktop:release` still creates an unsigned local `.app` without an
updater; use the packaging command or CI for distribution. Nothing is published
by a local build.

## One-time configuration

The public GitHub repository is `oogxdd/type`. The native feed lives at
`https://github.com/oogxdd/type/releases/download/gpui-updates/appcast.xml`,
independent of GitHub's latest release and the old Tauri `latest.json`.
Do not change the feed URL or signing key casually after shipping.

Repository secrets already configured (names checked on 2026-10-01):

| Secret | Purpose |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64 Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` |
| `APPLE_SIGNING_IDENTITY` | Full `Developer ID Application: … (TEAMID)` identity |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Apple ID, app-specific password and team for notarization |

These values have not been exercised by the GPUI pipeline yet. It also needs
one new secret `SPARKLE_PRIVATE_KEY` and one repository variable
`SPARKLE_PUBLIC_KEY`. Never reuse the Tauri updater key or put the private key
in this repository, a bundle, release assets or the synced notes root.

Generate the key once on your Mac using the pinned distribution:

```sh
python3 apps/gpui/scripts/sparkle.py /private/tmp/type-sparkle
/private/tmp/type-sparkle/bin/generate_keys --account type-gpui
/private/tmp/type-sparkle/bin/generate_keys --account type-gpui -p
```

The first command verifies the upstream archive's pinned SHA-256. Sparkle's
`generate_keys` stores the private key in macOS Keychain and prints the public
key. Put that public key in the repository variable. Export the private key
with `generate_keys --account type-gpui -x /path/to/private-key-file`, pass the
file directly to `gh secret set SPARKLE_PRIVATE_KEY --repo oogxdd/type < /path/to/private-key-file`,
then remove the exported file. Keep a secure backup of the signing key.

Configure GitHub environments `gpui-release` and `gpui-production` to restrict
who can build and promote releases. If a production reviewer is configured,
GitHub waits for their approval before promotion. Repository secrets are used
by both workflows; no credential values are exposed to app settings.

## Build a candidate

1. Update `apps/gpui/Cargo.toml` and its Cargo.lock package entry to the same
   numeric `major.minor.patch` version. Each native release must increase it.
2. Write `docs/releases/gpui-vVERSION.md`; the draft uses these notes and embeds
   them in the signed feed. Commit changes to `main` through the normal project
   process and let CI pass.
3. Push the immutable `gpui-vVERSION` tag on that commit. The **GPUI release
   candidate** workflow validates ancestry/version, runs functional checks,
   builds both architectures, bundles Sparkle 2.10.0, signs inside out,
   notarizes/staples the app and DMG, signs the feed and creates a **draft**.
   Manual dispatch accepts an existing tag for a build that failed before
   creating a draft. Existing candidate assets are never overwritten.

Artifacts: `Type-VERSION-universal.dmg`, `appcast.xml`, `release.json`.
The manifest records commit, DMG checksum and the previous feed checksum.
The first version's draft can be built with the included 0.4.5 release notes;
no tag or release was created during this implementation.

For a local candidate, install both Rust targets, import your Developer ID into
Keychain, provide the required environment variables above, then run:

```sh
npm run desktop:release:package -- --version VERSION --repository oogxdd/type \
  --output /private/tmp/type-release-VERSION \
  --sparkle-dir /private/tmp/type-sparkle \
  --notes docs/releases/gpui-vVERSION.md
```

Use a fresh output directory. For subsequent builds download the current
`gpui-updates/appcast.xml` and pass `--previous-feed /path/to/appcast.xml` so
the candidate retains previously signed releases. Packaging verifies that
previous feed before using it. The local command does not create a GitHub release.

## Test and promote

Download the draft DMG using authenticated GitHub/`gh`. Test on an isolated
profile: installation, launch, Unicode editing/save, restart and any sync used.
For the first release also test the real Sparkle old→new replacement path with
two signed/notarized fixture builds and a separate HTTPS test feed/key. Do not
point a test build at the production feed or start two shells on the same notes
root. Headless tests cover the save barrier but cannot prove Gatekeeper,
installer authorization or a real relaunch.

After the candidate passes, manually run **GPUI promote or withdraw** from
`main`, select `promote` and its version. The workflow checks the signed feed,
DMG checksum/signature/notarization and unchanged baseline feed. A candidate
built before another promotion/withdrawal is rejected; build a new version
against the current feed. It publishes downloads first, then replaces the
signed native feed. A failure after publishing downloads can be retried while
the live feed is still unchanged; assets are not replaced.

Promotion starts the rollout clock at publication, not at build time. Default
interval `86400` delivers one of Sparkle's seven groups per day. Manual checks
offer the update immediately; they bypass phased rollout by Sparkle design.
Set interval `0` for immediate availability to everyone.
See [Sparkle phased rollouts](https://sparkle-project.org/documentation/publishing/#phased-group-rollouts).

`gpui-v*` installers and the `gpui-updates` feed are marked `latest=false` so
legacy Tauri clients keep their existing latest.json endpoint. The first GPUI
installation is manual; native updates only begin after that installation.
The old `desktop-v*` workflow remains explicitly labeled Legacy Tauri.

## Withdraw a problem release

Run **GPUI promote or withdraw**, select `withdraw` and the problematic version.
It verifies the live feed, removes only that item, re-signs and replaces the
feed. Existing installed versions are not downgraded, and a downloaded/queued
update may still complete. Publish a higher fixed version to repair affected
installs. Keep old release assets available for the retained feed items.

## Verification status

Local GPUI and release-script/native-bridge tests use synthetic profiles and
keys. Actual Developer ID signing, notarization, Intel runtime, remote Actions
and signed/notarized old→new UI replacement still require the first candidate
smoke test. No release has been published as part of this integration.

Mobile is unchanged: [mobile distribution](MOBILE_AD_HOC_GITHUB_ACTIONS.md).
Migration journal: [GPUI status](GPUI_MIGRATION_STATUS.md).
