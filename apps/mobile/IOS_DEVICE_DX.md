# iOS Device DX Notes

This note captures developer-experience improvements for running the Expo
mobile app on a physical iPhone. It is intentionally a proposal document, not
an implemented workflow.

## Current problem

The root `mobile:ios` script looks like a generic iOS command, but it runs
simulator-only native core generation first:

```sh
npm run --workspace @typenotes/mobile-core codegen:ios
```

`codegen:ios` is `--sim-only`, so it can regenerate
`packages/mobile-core/TypenotesMobileCoreFramework.xcframework` without the
physical-device `ios-arm64` slice. After that, an iPhone build fails later in
Xcode with an unhelpful linker error:

```text
ld: library 'type_ffi' not found
```

There is a second footgun: the device Rust build needs the same iOS deployment
target as the app. Without this environment variable, the Rust/iOS link can fail
while building the device slice:

```sh
IPHONEOS_DEPLOYMENT_TARGET=16.4
```

## Desired command shape

Make simulator and physical-device flows explicit.

```json
{
  "mobile:ios:sim": "npm run --workspace @typenotes/mobile-core codegen:ios && npm run --workspace @typenotes/mobile ios",
  "mobile:ios:device:prepare": "IPHONEOS_DEPLOYMENT_TARGET=16.4 npm run --workspace @typenotes/mobile-core codegen:ios:device && cd apps/mobile/ios && pod install",
  "mobile:ios:device": "npm run --workspace @typenotes/mobile ios -- --device",
  "mobile:ios:device:no-bundler": "npm run --workspace @typenotes/mobile ios -- --device --no-bundler"
}
```

The current root `mobile:ios` name should either be deprecated or changed to an
alias with clear simulator naming. A command that sounds universal should not
silently remove the device slice.

## Recommended decision tree

Use this mental model until the scripts are improved:

```text
JS/TS UI only
  -> npm run mobile:start
  -> open the already-installed dev build on the iPhone, or scan the QR

Need to reinstall on the iPhone, Metro already running
  -> npm run --workspace @typenotes/mobile ios -- --device --no-bundler

Need to reinstall on the iPhone, Metro not running
  -> npm run --workspace @typenotes/mobile ios -- --device

Rust/core/FFI/native dependency changed, or after clean/prebuild
  -> IPHONEOS_DEPLOYMENT_TARGET=16.4 npm run --workspace @typenotes/mobile-core codegen:ios:device
  -> cd apps/mobile/ios && pod install
  -> npm run --workspace @typenotes/mobile ios -- --device
```

Avoid this command for physical-device work:

```sh
npm run mobile:ios
```

It currently rebuilds the simulator-only core first.

## Preflight check idea

Add a small script before device install, for example
`scripts/check-mobile-ios-device-ready.mjs`, that verifies:

- `packages/mobile-core/TypenotesMobileCoreFramework.xcframework/Info.plist`
  contains an `ios-arm64` library.
- `apps/mobile/ios/Pods/Target Support Files/TypeCore/TypeCore-xcframeworks.sh`
  includes both `ios-arm64` and `ios-arm64-simulator`.
- `apps/mobile/ios/Pods/Target Support Files/Pods-Type/Pods-Type.debug.xcconfig`
  and `.release.xcconfig` include `-lz -liconv`.

If any check fails, print the fix directly:

```sh
IPHONEOS_DEPLOYMENT_TARGET=16.4 npm run --workspace @typenotes/mobile-core codegen:ios:device
cd apps/mobile/ios
pod install
```

This would turn the current Xcode linker failure into a fast, understandable
terminal message.

## Documentation improvement

The mobile README should eventually include a short "Simulator vs physical
iPhone" section that links to the exact commands above. The key point to
document prominently: simulator builds are faster, but simulator-only codegen is
not valid for an iPhone install.
