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

Developer ID import succeeded in the first candidate run on 2026-10-01;
notarization credentials still await a completed packaging run.
On 2026-10-01, `SPARKLE_PRIVATE_KEY` and the repository variable
`SPARKLE_PUBLIC_KEY` were configured using a dedicated `type-gpui` key in the
maintainer's macOS Keychain. Environments `gpui-release` and `gpui-production`
restrict deployment sources to `gpui-v*` tags and the `main` branch respectively.
Never reuse the Tauri updater key or put the private key
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
The initial `gpui-v0.4.5` tag remains immutable. Its candidate run passed
functional checks but stopped before building due to a macOS Bash empty-array
error; no draft or update was published. Version 0.4.6 contains that packaging
correction and the current-line typing highlight fix.

## Alternative: build locally and upload the artifacts yourself

This uses the same signing, notarization, native feed and promotion checks as
CI. GitHub does not rebuild an uploaded local candidate. A plain
`npm run desktop:release` is not sufficient for distribution.

### Prepare the Mac once

- Install Xcode command-line tools and the pinned Rust toolchain from
  `rust-toolchain.toml`; use Python 3.12 or later.
- Import the **Developer ID Application** certificate and its private key into
  macOS Keychain. `security find-identity -v -p codesigning` must show it.
  An Apple Development or Apple Distribution identity is not a substitute.
- Run `gh auth login` for `oogxdd/type` and install both build targets:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

GitHub secrets cannot be downloaded back to this Mac. Store your Apple ID and
an Apple **app-specific password** locally, using interactive Keychain prompts:

```sh
security add-generic-password -U -a "$USER" -s type-apple-id -w
security add-generic-password -U -a "$USER" -s type-apple-app-password -w
```

The dedicated Sparkle private key created during setup is already in this Mac's
Keychain under account `type-gpui`. Do not generate a replacement signing key
for each release. On a new Mac, securely restore the existing key first.

### Build a candidate

Start from a clean, committed checkout of `main`, after its checks pass. Update
the GPUI version and release notes as described above. The committed version
must match `VERSION`; the output directory must be fresh.

```sh
VERSION=0.4.6  # replace with the new committed GPUI version
python3 apps/gpui/scripts/sparkle.py /private/tmp/type-sparkle

export APPLE_SIGNING_IDENTITY='Developer ID Application: Maxim Ignatev (Y377P5XKGJ)'
export APPLE_TEAM_ID=Y377P5XKGJ
export APPLE_ID="$(security find-generic-password -s type-apple-id -w)"
export APPLE_PASSWORD="$(security find-generic-password -s type-apple-app-password -w)"
export SPARKLE_PUBLIC_KEY="$(/private/tmp/type-sparkle/bin/generate_keys --account type-gpui -p)"

# Export only to a private temporary directory; remove it on exit.
(
  set -eu
  key_export_dir="$(mktemp -d /private/tmp/type-sparkle-key.XXXXXX)"
  trap 'rm -rf "$key_export_dir"; unset SPARKLE_PRIVATE_KEY' EXIT
  /private/tmp/type-sparkle/bin/generate_keys --account type-gpui -x "$key_export_dir/key"
  chmod 600 "$key_export_dir/key"
  export SPARKLE_PRIVATE_KEY="$(cat "$key_export_dir/key")"

  set -- --version "$VERSION" --repository oogxdd/type \
    --output "/private/tmp/type-release-$VERSION" \
    --sparkle-dir /private/tmp/type-sparkle \
    --notes "docs/releases/gpui-v$VERSION.md"
  if gh release view gpui-updates --repo oogxdd/type >/dev/null 2>&1; then
    gh release download gpui-updates --repo oogxdd/type --pattern appcast.xml --dir "$key_export_dir"
    set -- "$@" --previous-feed "$key_export_dir/appcast.xml"
  fi

  npm run desktop:release:package -- "$@"
)
unset APPLE_ID APPLE_PASSWORD
```

Use Bash or Zsh for this snippet. Positional arguments also work with the
macOS system Bash when the first release has no previous feed. Do not enable
shell tracing (`set -x`) while working with credentials. The packaging command
builds both architectures, signs and notarizes the app/DMG, staples tickets and
generates the signed feed and provenance. It publishes nothing. Later candidates
must retain the current feed with `--previous-feed`; the snippet downloads it
and packaging verifies its signature before use.

Only these three files are uploaded, from `/private/tmp/type-release-VERSION/`:

| File | Purpose |
| --- | --- |
| `Type-VERSION-universal.dmg` | Signed/notarized installer and update payload |
| `appcast.xml` | Signed candidate feed, including retained prior releases |
| `release.json` | Version, source commit, bundle ID and artifact/baseline hashes |

### Upload to GitHub without a duplicate CI build

Do not push the tag until packaging succeeds. Temporarily disable only the
**GPUI release candidate** workflow so the tag does not start another build.
Ordinary CI and promotion remain enabled:

```sh
gh workflow disable gpui-release.yml --repo oogxdd/type
git tag "gpui-v$VERSION"
git push origin "gpui-v$VERSION"
```

In GitHub → Releases → **Draft a new release**, select that existing tag,
use title `Type VERSION`, copy `docs/releases/gpui-vVERSION.md`, and attach
exactly the three files above. **Save draft**, then re-enable the candidate
workflow immediately, including if the upload fails:

```sh
gh workflow enable gpui-release.yml --repo oogxdd/type
```

Alternatively, upload the same draft from the terminal:

```sh
gh release create "gpui-v$VERSION" \
  "/private/tmp/type-release-$VERSION/Type-$VERSION-universal.dmg" \
  "/private/tmp/type-release-$VERSION/appcast.xml" \
  "/private/tmp/type-release-$VERSION/release.json" \
  --repo oogxdd/type --verify-tag --draft --latest=false \
  --title "Type $VERSION" --notes-file "docs/releases/gpui-v$VERSION.md"
```

Do not upload a private key, certificate, credential file or development bundle.
Keep candidate assets immutable. If packaging changes, use a new version.
Test this draft and promote it through **GPUI promote or withdraw**, exactly as
with a CI-built candidate. Do not publish it directly or manually replace the
live `gpui-updates/appcast.xml`: the promotion workflow verifies the signatures,
notarization, DMG hash and unchanged feed baseline before publication.

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
