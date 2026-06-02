#!/usr/bin/env bash
# Set the app version everywhere from a single argument, WITHOUT creating a git
# tag or commit. Writes package.json then mirrors it into tauri.conf.json via
# sync-version.sh. Used by CI (version comes from the release tag) and by the
# local release script.
#
# Usage: scripts/set-app-version.sh 1.2.3
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "usage: $0 <version>   (e.g. 1.2.3)" >&2
  exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/.."

npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null
bash "$DIR/sync-version.sh"
echo "App version set to $VERSION (package.json + tauri.conf.json)"
