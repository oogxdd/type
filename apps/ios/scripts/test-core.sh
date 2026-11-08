#!/bin/bash
set -euo pipefail
IOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$IOS_DIR/../.." && pwd)"
"$IOS_DIR/scripts/prepare.sh" --host-only
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/type-swift-core.XXXXXX")"
trap 'rm -rf "$BUILD_DIR"' EXIT
swiftc -swift-version 6 -parse-as-library -emit-module -emit-library -module-name TypeDomain \
  "$IOS_DIR"/Sources/TypeDomain/*.swift -emit-module-path "$BUILD_DIR/TypeDomain.swiftmodule" \
  -o "$BUILD_DIR/libTypeDomain.dylib"
swiftc -swift-version 5 -parse-as-library -emit-module -emit-library -module-name TypeCoreBindings \
  "$IOS_DIR"/Generated/*.swift -I "$IOS_DIR/Generated" \
  -L "$REPO_DIR/target/debug" -ltype_ffi \
  -Xlinker -rpath -Xlinker "$REPO_DIR/target/debug" \
  -emit-module-path "$BUILD_DIR/TypeCoreBindings.swiftmodule" -o "$BUILD_DIR/libTypeCoreBindings.dylib"
swiftc -swift-version 6 -parse-as-library -emit-module -emit-library -module-name TypeCoreAdapter \
  "$IOS_DIR"/Sources/TypeCoreAdapter/*.swift \
  -I "$BUILD_DIR" -I "$IOS_DIR/Generated" -L "$BUILD_DIR" -lTypeDomain -lTypeCoreBindings \
  -emit-module-path "$BUILD_DIR/TypeCoreAdapter.swiftmodule" -o "$BUILD_DIR/libTypeCoreAdapter.dylib"
swiftc -swift-version 6 -parse-as-library "$IOS_DIR/IntegrationTests/CoreSmoke.swift" \
  -I "$BUILD_DIR" -I "$IOS_DIR/Generated" -L "$BUILD_DIR" -lTypeDomain -lTypeCoreAdapter \
  -Xlinker -rpath -Xlinker "$BUILD_DIR" -o "$BUILD_DIR/CoreSmoke"
"$BUILD_DIR/CoreSmoke"
