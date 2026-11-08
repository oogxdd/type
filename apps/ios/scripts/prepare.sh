#!/bin/bash
set -euo pipefail
IOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$IOS_DIR/../.." && pwd)"
cd "$REPO_DIR"
# Host dylib carries the same UniFFI metadata as the iOS static libraries.
cargo build --locked -p type-ffi --features bindgen
mkdir -p "$IOS_DIR/Generated" "$IOS_DIR/Frameworks"
target/debug/type-swift-bindgen generate --metadata-no-deps --library target/debug/libtype_ffi.dylib \
  --language swift --config "$IOS_DIR/uniffi.toml" --out-dir "$IOS_DIR/Generated"
cp "$IOS_DIR/Generated/TypeCoreFFI.modulemap" "$IOS_DIR/Generated/module.modulemap"
if [[ "${1:-}" == "--host-only" ]]; then exit 0; fi
mkdir -p "$IOS_DIR/Generated/Headers"
cp "$IOS_DIR/Generated/TypeCoreFFI.h" "$IOS_DIR/Generated/module.modulemap" "$IOS_DIR/Generated/Headers/"
export IPHONEOS_DEPLOYMENT_TARGET=17.0
cargo build --locked -p type-ffi --target aarch64-apple-ios-sim
cargo build --locked -p type-ffi --target aarch64-apple-ios
# xcodebuild requires a nonexistent output path; only remove our generated artifact.
rm -rf "$IOS_DIR/Frameworks/TypeCore.xcframework"
xcodebuild -create-xcframework \
  -library "$REPO_DIR/target/aarch64-apple-ios-sim/debug/libtype_ffi.a" -headers "$IOS_DIR/Generated/Headers" \
  -library "$REPO_DIR/target/aarch64-apple-ios/debug/libtype_ffi.a" -headers "$IOS_DIR/Generated/Headers" \
  -output "$IOS_DIR/Frameworks/TypeCore.xcframework"
xcodegen generate --spec "$IOS_DIR/project.yml"
