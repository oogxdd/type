# Mobile architecture and the Swift handoff

This is the current React Native shell, not a specification for a Swift UI.
Preserve the storage and lifecycle contracts while replacing the presentation.

## Ownership

| Location | Responsibility | Swift destination |
| --- | --- | --- |
| `crates/type-core` | Notes, profiles, encryption, sync, attachment persistence | Keep shared Rust services |
| `crates/type-ffi`, `packages/mobile-core` | Native exports and typed JS facade | Build a Swift-facing adapter over the native exports; do not translate the JS facade blindly |
| `src/domain` | Pure projections and policies: feed, folders, gestures, sync scheduling, appearance | Port necessary policies with their test cases |
| `src/application` | Draft/page state machines, task lifetimes, recording session, job scheduling | App-owned services independent of views |
| `src/platform` | Expo/native adapters, worker execution, diagnostics | UIKit/AVFoundation/filesystem implementations |
| `src/core` | Boot and composition of the runtime with concrete storage; draft flush registration | Composition root and dependency wiring |
| `src/state` | Zustand projections plus orchestration of core/platform services | Observable UI state and app coordinators |
| `src/hooks` | React subscriptions and feed lifecycle | Swift observation/task integration |
| `src/screens`, `src/ui` | Navigation, gestures, rendering and controls | Swift UI |

Domain and application production modules must not import React, Zustand,
Expo, native modules, or the composition root. Application services accept
dependencies through explicit contracts (`CaptureStorage`, `NotePageStorage`,
`RecordingSessionDeps`). Tests live next to their subject.

The state layer still orchestrates several services; it is not a pure model.
Screens also call the typed core facade. Do not infer a strict screen → store
pipeline that the implementation does not enforce. Future extractions should
follow a concrete use case rather than introduce a second generic core facade.

## Contracts to preserve

- `application/capture.ts`: serialize writes, preserve edits arriving during a
  save, retain failed drafts, check the disk baseline before destructive writes.
- `application/note-pages.ts`: capture and saved-note browsing share one surface
  but have separate lifetimes. A failed read/save must retain the current page.
- `application/mobile-runtime.ts`: runtime owns drafts beyond view lifetime.
  Workspace tokens invalidate stale completions. Flush before switching roots;
  locking seals recovery and removes plaintext state.
- `core/runtime.ts`: binds page storage to a captured workspace token and the
  checked-write API. Never replace this with unguarded writes from a Swift view.
- `application/recording-session.ts` and `platform/recording-journal.ts`:
  stopping capture and importing the result are independent. Persist pending
  imports and recover them only in their original workspace.
- `domain/note-processing.ts`: worker-safe preview/cache transformations.
  `platform/note-worker.native.ts` is the RN execution strategy, not a domain
  requirement. Keep its platform suffix: Metro selects it on devices.
- Profile changes and locking invalidate preview caches. Encryption disables
  plaintext snapshots. Keep credentials and device settings outside synced notes.

See [GESTURES.md](GESTURES.md) for interaction contracts and
[the runtime notes](../../docs/MOBILE_RUNTIME.md) for lifecycle/device checks.

## Suggested migration order

1. Expose and test the Swift core adapter using synthetic temporary profiles.
   Verify missing versus locked reads, checked writes and unknown frontmatter.
2. Implement app-owned capture/page/runtime services. Use the adjacent TS tests
   as behavioral fixtures for save races, retries, switching roots and locking.
3. Add the editor and navigation, then feed/folder projections. Retain native
   text input, Unicode and IME. Validate gesture feel separately on device.
4. Add durable recording import, encryption, sync and lifecycle background work.
   Port the failure cases before connecting real notes.
5. Replace Expo adapters with native implementations. The existing local modules
   under `modules/` contain useful UIKit implementations (especially editor
   caret geometry and backup export); review their lifecycle assumptions first.

Do not copy Zustand, Reanimated or Worklet runtime machinery into Swift.
The app still supports Android; this organization does not remove that support
or change the native ABI.

## Verification of this reorganization

The move is intended to preserve behavior and keeps tests beside the modules.
Run `npm run typecheck -w @typenotes/mobile` and
`npm run test -w @typenotes/mobile`. Native builds and physical interaction
checks remain separate; no app restart or personal notes are needed.

Checked after the move (2026-10-28): mobile TypeScript check passed; Vitest
passed 30 files / 206 tests, including the dependency-boundary test. Native
builds and physical iOS/Android interactions were not run.

## Native iOS implementation

The first Swift shell now lives in [`../ios`](../ios/README.md). Its domain package
and real-core integration tests implement the initial editor/save contracts;
[`../ios/MIGRATION.md`](../ios/MIGRATION.md) tracks delivered and deferred slices.
The React Native shell remains available throughout migration.
