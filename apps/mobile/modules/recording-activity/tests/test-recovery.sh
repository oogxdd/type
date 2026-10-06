#!/bin/sh
set -eu
module_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_dir=$(mktemp -d /tmp/type-recording-recovery.XXXXXX)
trap 'rm -rf "$test_dir"' EXIT
xcrun swiftc -module-cache-path "$test_dir/cache" \
  "$module_dir/ios/RecordingRecovery.swift" "$module_dir/tests/main.swift" \
  -o "$test_dir/recovery-test"
"$test_dir/recovery-test"
