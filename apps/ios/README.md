# Type for iOS — native Swift shell

First vertical slice of the React Native → Swift migration. iOS 26+, SwiftUI,
Swift 6, the existing Rust `type-core` through UniFFI. No React Native runtime.

The shell currently requires iOS 26: core's `netdev 0.45` dependency directly
imports `nw_path_is_ultra_constrained` (available since iOS 26). Supporting older
iOS needs an availability-safe fix to that dependency before lowering the app's
deployment target. The standalone domain package itself only needs iOS 17.

Implemented: Stream and folder browsing, bounded list summaries, new notes,
plain Markdown editing with native text input, 400 ms autosave, checked writes,
empty-note cleanup on leaving, conflict handling (retry/export/discard), local
draft recovery, and background save assertions. Core preserves frontmatter and
owns filenames, folder order, tree filtering and all note mutations.

This is a separate development app (`com.digital.type.swift.dev`, “Type Swift”).
It starts with its own empty sandbox and does not import or open the existing
mobile/desktop app's data. Notes use the existing core profile layout under
Application Support/TypeSwift. No profile switching or external folder picker is
exposed yet. Encryption, lock screen and panic mode are deliberately deferred;
do not connect this shell's plaintext recovery to encrypted workspaces.

## Build and run

On an Apple Silicon Mac with Xcode, the repo's Rust toolchain and XcodeGen:

```sh
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
apps/ios/scripts/prepare.sh
open apps/ios/Type.xcodeproj
```

Select the **Type** scheme and an iOS simulator. For a physical device, choose
your signing team on the app and framework targets. Generated bindings, XCFramework and Xcode
project are ignored; `project.yml` is the source of truth. Run `prepare.sh` again
after changing Rust exports or the project specification. Both Rust slices use
the debug profile; distribution/signing/optimized packaging are a later step.

Command-line build without signing:

```sh
xcodebuild -project apps/ios/Type.xcodeproj -scheme Type \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath apps/ios/DerivedData CODE_SIGNING_ALLOWED=NO build
```

## Boundaries

- `Sources/TypeDomain`: Foundation/Observation models, repository protocol,
  editor state and save coordination. A standalone Swift package, tested on Mac.
- `Sources/TypeCoreAdapter`: JSON decoding and direct UniFFI calls. Does not
  implement Markdown parsing or storage rules. The Rust ABI remains unchanged.
- `TypeCoreBindings`: generated UniFFI code in its own module. UniFFI 0.31
  callback helpers require Swift 5 language mode; only this generated target
  uses it. The adapter, domain and UI compile in Swift 6 mode.
- `Sources/TypeApp`: SwiftUI views, composition root, UIKit background assertion
  and device-local draft file. Views never write Markdown files.
- `IntegrationTests`: real Swift → Rust checks using a synthetic temporary root.

One model owns the draft beyond editor-view lifetime. Concurrent flushes share
one writer; a write advances only the baseline of the snapshot it actually
saved, then drains newer edits. A conflict blocks dismissal and preserves the
draft. Empty text is checked and deleted only when leaving. A failed read is
not an empty note. Each edit atomically updates local recovery before debounce.
Recovery is intentionally single-workspace and plaintext with iOS file protection.

Known recovery boundary: process death between a successful Rust create and
recording its returned path can recover an unsaved capture that duplicates the
just-created note. Exactly-once capture needs a core idempotency contract; do
not hide that gap by guessing filenames. No background sync is implemented.

## Checks

```sh
swift test --package-path apps/ios
apps/ios/scripts/test-core.sh
```

Swift tests cover edits during an in-flight create, conflicts, empty-note
lifecycle, missing reads and restored drafts. The integration executable tests
real Rust persistence, Unicode, summaries, unknown frontmatter, stale baselines,
checked deletion and missing reads. It sets `NOTES_ROOT` to a fresh temporary
fixture before initializing core and removes that fixture on completion.

## Next slices

1. Validate editor/keyboard/scrolling on a phone; refine navigation and capture
   gestures against the existing app's `GESTURES.md`.
2. Note organization (move/rename/trash), search, profiles and controlled import.
3. Sync settings and lifecycle, including workspace invalidation and flushes.
4. AVFoundation recording and durable imports; transcription adapters.
5. Encryption, sealed recovery, lock lifecycle and panic-state teardown.

See [MIGRATION.md](MIGRATION.md) for the current verification record.
