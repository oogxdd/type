#!/usr/bin/env bash
# Local release fallback — same outcome as the GitHub Actions Release workflow,
# but built on your own Mac. Use this once you exhaust the free macOS CI minutes,
# or any time you'd rather build locally.
#
# Usage:
#   scripts/release-local.sh <version> <desktop|ios|both>
#
# Examples:
#   scripts/release-local.sh 1.2.3 desktop
#   scripts/release-local.sh 1.2.4 both
#
# Prerequisites:
#   - Run on macOS.
#   - `gh auth login` done (used to create the GitHub Release for desktop).
#   - Desktop: TAURI_SIGNING_PRIVATE_KEY + TAURI_SIGNING_PRIVATE_KEY_PASSWORD set
#     (see docs/RELEASING.md). The key is the one from `tauri signer generate`.
#   - iOS: Apple signing set up locally (same as your existing `npm run ios:build`).
set -euo pipefail

VERSION="${1:-}"
PLATFORMS="${2:-both}"
REPO="oogxdd/type_new"   # owner/name used in the updater download URLs

if [ -z "$VERSION" ]; then
  echo "usage: $0 <version> <desktop|ios|both>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DO_DESKTOP=false
DO_IOS=false
case "$PLATFORMS" in
  both)    DO_DESKTOP=true; DO_IOS=true ;;
  desktop) DO_DESKTOP=true ;;
  ios)     DO_IOS=true ;;
  *) echo "platform must be desktop | ios | both" >&2; exit 1 ;;
esac

TAG="v$VERSION"
echo "==> Releasing $TAG (desktop=$DO_DESKTOP ios=$DO_IOS)"

bash scripts/set-app-version.sh "$VERSION"

if [ "$DO_DESKTOP" = true ]; then
  : "${TAURI_SIGNING_PRIVATE_KEY:?set TAURI_SIGNING_PRIVATE_KEY (the updater private key)}"
  : "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:?set TAURI_SIGNING_PRIVATE_KEY_PASSWORD}"

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
fi

if [ "$DO_IOS" = true ]; then
  echo "==> Building & uploading iOS to App Store Connect"
  # Reuses your existing native iOS build + push scripts.
  npm run ios:build
  npm run ios:push
  echo "==> iOS build uploaded to App Store Connect."
fi

echo "==> Done: $TAG"
