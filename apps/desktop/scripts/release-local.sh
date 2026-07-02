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
REPO="oogxdd/type_new"   # owner/name used in the updater download URLs

if [ -z "$VERSION" ]; then
  echo "usage: $0 <version>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TAG="v$VERSION"
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

echo "==> Building desktop bundle (.dmg + updater)"
# macOS updater artifacts are produced from the `app` bundle target when
# `bundle.createUpdaterArtifacts` is enabled. Building only `dmg` creates the
# installer but not `Type.app.tar.gz` / `.sig`.
npm run tauri build -- --bundles app,dmg

DMG=$(find src-tauri/target/release/bundle/dmg -name "*.dmg" | head -1)
TARGZ=$(find src-tauri/target/release/bundle/macos -name "*.app.tar.gz" | head -1)
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
  --title "Type $TAG" \
  --notes "Automated desktop release. Existing installs update in-app via Settings → Updates." \
  --latest

rm -f latest.json
echo "==> Desktop release published."

echo "==> Done: $TAG"
