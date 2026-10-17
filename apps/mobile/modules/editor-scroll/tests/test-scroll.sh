#!/bin/sh
set -eu
module_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/type-editor-scroll.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT
xcrun swiftc -module-cache-path "$test_dir/cache" \
  "$module_dir/ios/EditorScrollGeometry.swift" "$module_dir/tests/main.swift" \
  -o "$test_dir/test-scroll"
"$test_dir/test-scroll"
