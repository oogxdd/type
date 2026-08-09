#!/usr/bin/env bash
# Local release fallback — same outcome as the GitHub Actions Release workflow,
# but built on your own Mac. Use this once you exhaust the free macOS CI minutes,
# or any time you'd rather build locally.
#
# Usage:
#   scripts/release-local.sh <version>
#
# Example:
#   scripts/release-local.sh 1.2.3
#
# Prerequisites:
#   - Run on macOS.
#   - `gh auth login` done (used to create the GitHub Release).
#   - Signing credentials resolvable — see "Credentials" below. Nothing needs to
#     be exported by hand if they're in the login Keychain.
set -euo pipefail

VERSION="${1:-}"
REPO="oogxdd/type"   # owner/name used in the updater download URLs

if [ -z "$VERSION" ]; then
  echo "usage: $0 <version>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TAG="desktop-v$VERSION"
echo "==> Releasing $TAG"

bash scripts/set-app-version.sh "$VERSION"

# ── Credentials ───────────────────────────────────────────────────────────────
# Resolved in order: existing environment → login Keychain → derived from what's
# already on the machine. The Keychain is used rather than a dotenv file because
# these are release-signing secrets: a .env is plaintext on disk, one .gitignore
# slip from being committed, whereas `security` items are encrypted at rest and
# survive across shells. Seed them once with:
#
#   security add-generic-password -a "$USER" -s type-updater-key-password -w
#   security add-generic-password -a "$USER" -s type-apple-app-password -w
#   security add-generic-password -a "$USER" -s type-apple-id -w
#
# (-w with no value prompts, so nothing lands in shell history.)
keychain() { security find-generic-password -s "$1" -w 2>/dev/null || true; }

UPDATER_KEY_FILE="${UPDATER_KEY_FILE:-$HOME/.tauri/type-updater.key}"
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -f "$UPDATER_KEY_FILE" ]; then
  TAURI_SIGNING_PRIVATE_KEY="$(cat "$UPDATER_KEY_FILE")"
fi
: "${TAURI_SIGNING_PRIVATE_KEY:?no updater key: $UPDATER_KEY_FILE missing and TAURI_SIGNING_PRIVATE_KEY unset (see docs/UPDATER_KEY_ROTATION.md)}"

TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-$(keychain type-updater-key-password)}"
: "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:?no updater key password in env or Keychain (see the seeding commands above)}"
export TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD

# Apple signing is optional here (the build still produces an installable .dmg
# without it) but strongly wanted: shipping unsigned to people on a notarized
# build means macOS refuses to launch their next fresh install.
if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  APPLE_SIGNING_IDENTITY="$(security find-identity -v -p codesigning \
    | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p' | head -1)"
fi
if [ -n "$APPLE_SIGNING_IDENTITY" ]; then
  # Team ID is the parenthesized suffix of the identity: "… (Y377P5XKGJ)".
  APPLE_TEAM_ID="${APPLE_TEAM_ID:-$(printf '%s' "$APPLE_SIGNING_IDENTITY" | sed -n 's/.*(\([A-Z0-9]*\))$/\1/p')}"
  APPLE_ID="${APPLE_ID:-$(keychain type-apple-id)}"
  APPLE_PASSWORD="${APPLE_PASSWORD:-$(keychain type-apple-app-password)}"

  if [ -n "$APPLE_ID" ] && [ -n "$APPLE_PASSWORD" ]; then
    export APPLE_SIGNING_IDENTITY APPLE_TEAM_ID APPLE_ID APPLE_PASSWORD
    echo "==> Apple signing: $APPLE_SIGNING_IDENTITY (team $APPLE_TEAM_ID)"
  else
    echo "WARNING: found a Developer ID certificate but no notarization" >&2
    echo "credentials (APPLE_ID / APPLE_PASSWORD, or the Keychain items above)." >&2
    echo "Building WITHOUT signing — see docs/MACOS_CODE_SIGNING.md." >&2
    unset APPLE_SIGNING_IDENTITY APPLE_TEAM_ID
  fi
fi

PUBKEY=$(node -e 'const c = require("./src-tauri/tauri.conf.json"); process.stdout.write((c.plugins?.updater?.pubkey || "").trim())')
if [ -z "$PUBKEY" ] || [ "$PUBKEY" = "REPLACE_WITH_UPDATER_PUBLIC_KEY" ]; then
  echo "Updater pubkey is not configured in src-tauri/tauri.conf.json." >&2
  echo "Generate it with: npm run tauri signer generate -- -w ~/.tauri/type-updater.key" >&2
  echo "Then paste ~/.tauri/type-updater.key.pub into plugins.updater.pubkey and commit it." >&2
  exit 1
fi
if ! printf '%s' "$PUBKEY" | grep -Eq '^[A-Za-z0-9+/=]+$'; then
  echo "Updater pubkey in src-tauri/tauri.conf.json is not valid base64." >&2
  echo "Paste the full single-line contents of ~/.tauri/type-updater.key.pub." >&2
  exit 1
fi

echo "==> Building desktop bundle (.dmg + updater)"
# macOS updater artifacts are produced from the `app` bundle target when
# `bundle.createUpdaterArtifacts` is enabled. Building only `dmg` creates the
# installer but not `*.app.tar.gz` / `.sig`.
npm run tauri build -- --bundles app,dmg

# One Cargo workspace at the repo root means bundles land in <root>/target/,
# not under src-tauri/. Ask cargo rather than assuming, so CARGO_TARGET_DIR and
# any future layout change keep working.
TARGET_DIR=$(cargo metadata --format-version 1 --no-deps --manifest-path src-tauri/Cargo.toml \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).target_directory))')
BUNDLE_DIR="$TARGET_DIR/release/bundle"

DMG=$(find "$BUNDLE_DIR/dmg" -name "*.dmg" 2>/dev/null | head -1)
TARGZ=$(find "$BUNDLE_DIR/macos" -name "*.app.tar.gz" 2>/dev/null | head -1)
SIG_FILE="$TARGZ.sig"

if [ -z "$DMG" ] || [ -z "$TARGZ" ] || [ ! -f "$SIG_FILE" ]; then
  echo "Build artifacts not found (dmg/tar.gz/sig). Aborting." >&2
  exit 1
fi

SIGNATURE=$(cat "$SIG_FILE")
PUB_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# latest.json is what the in-app updater reads. tauri-action generates this in
# CI; locally we assemble it ourselves.
cat > latest.json <<JSON
{
  "version": "$VERSION",
  "notes": "Release $TAG",
  "pub_date": "$PUB_DATE",
  "platforms": {
    "darwin-aarch64": {
      "signature": "$SIGNATURE",
      "url": "https://github.com/$REPO/releases/download/$TAG/$(basename "$TARGZ")"
    }
  }
}
JSON

echo "==> Creating GitHub Release $TAG and uploading assets"
gh release create "$TAG" "$DMG" "$TARGZ" latest.json \
  --repo "$REPO" \
  --title "Type Desktop $VERSION" \
  --notes "Automated desktop release. Existing installs update in-app via Settings → Updates." \
  --latest

rm -f latest.json
echo "==> Desktop release published."

echo "==> Done: $TAG"
