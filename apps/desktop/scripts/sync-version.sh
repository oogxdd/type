#!/usr/bin/env bash
set -e

VERSION=$(node -p "require('./package.json').version")

jq ".version = \"$VERSION\"" src-tauri/tauri.conf.json > src-tauri/tauri.conf.tmp
mv src-tauri/tauri.conf.tmp src-tauri/tauri.conf.json

echo "Synced tauri.conf.json to $VERSION"
