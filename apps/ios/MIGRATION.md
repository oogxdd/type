# Native iOS migration journal

## 2026-10-28 — first working slice (uncommitted)

Added the independent `apps/ios` shell, Swift package for editor state, direct
UniFFI adapter, reproducible XcodeGen project and Rust XCFramework preparation.
The prior React Native reorganization is retained in the working tree.

Scope: browse Stream/folders; create/open/edit notes; serial checked autosave;
recover drafts; retain/export/discard conflicts; delete dirty empty notes only
when leaving; flush on inactive/background transitions. New bundle/container.
No changes to the native exports, TS facade, Rust storage or security behavior.

Verified:

- `swift test --package-path apps/ios`: 6 tests passed, including concurrent
  edits during create, conflict retention/discard, checked empty-note removal,
  missing reads and restored baselines.
- `apps/ios/scripts/test-core.sh`: real Swift → UniFFI → Rust integration passed
  on a temporary profile (Unicode, summaries, tree, unknown frontmatter,
  stale-baseline rejection, checked deletion and missing reads).
- `apps/ios/scripts/prepare.sh`: arm64 device + simulator XCFramework generated.
- Xcode Debug builds passed for generic iOS Simulator and generic iOS device,
  with signing disabled. No physical-device installation was performed.
- Installed and launched in a separate temporary iPhone 17 Pro / iOS 26.5
  simulator. Screenshot confirmed the empty Stream screen without startup error.
  Interactive editor/keyboard/gesture checks remain for the user on a phone.
- `git diff --check` passed. No commits or changes to personal notes.

Build compatibility: generated UniFFI 0.31 callbacks compile in a separate
Swift 5 module; all authored Swift remains in Swift 6 mode. The app currently
requires iOS 26 because `netdev 0.45` directly imports the iOS 26 symbol
`nw_path_is_ultra_constrained`. Older iOS support needs a dependency fix.

Recovery limitation: a process crash between Rust create success and persisting
its returned path can produce a duplicate capture on recovery. Exactly-once
creation requires a core idempotency contract.

Deferred: physical device interaction, React Native gesture parity, large-library
performance (summaries currently load in sequential batches of 200), search,
move/rename/trash UI, profiles/import, sync, recording, transcription, encryption,
lock/panic mode and release packaging. This first slice is not feature parity.
