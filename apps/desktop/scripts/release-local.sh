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
#   - TAURI_SIGNING_PRIVATE_KEY + TAURI_SIGNING_PRIVATE_KEY_PASSWORD set
#     (see docs/RELEASING.md). The key is the one from `tauri signer generate`.
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

: "${TAURI_SIGNING_PRIVATE_KEY:?set TAURI_SIGNING_PRIVATE_KEY (the updater private key)}"
: "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:?set TAURI_SIGNING_PRIVATE_KEY_PASSWORD}"

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

# Production releases from CI are Apple-signed and notarized. Releasing locally
# without these exported would publish an *unsigned* update to people already
# running a notarized build — a silent downgrade, so say so loudly.
if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo
  echo "WARNING: APPLE_SIGNING_IDENTITY is not set — this build will NOT be" >&2
  echo "signed or notarized, and macOS will refuse to launch it on a fresh" >&2
  echo "install. See docs/MACOS_CODE_SIGNING.md for the four exports needed." >&2
  echo
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
