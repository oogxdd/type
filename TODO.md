# React Native monorepo — working TODO

Branch: `feat/react-native-monorepo`. This file tracks in-flight work and
deferred checks (the dev VM is slow, so full builds are delegated to CI).
Delete this file when the branch is ready for review.

## Deferred verification (do before merging)

- [ ] Full `cargo check --workspace` + `cargo test --workspace --lib` after M4
      (type-ffi crate added). Killed locally to save time — desktop crate does
      not depend on type-ffi, so risk is low. **CI on push covers this.**
- [ ] Confirm CI is green on the branch after each push (typescript + rust jobs).
- [ ] `npm run build` (desktop vite + OTA) after the M5 shared-package refactor.
- [ ] On a Mac: iOS/Android native builds of the RN app (this VM has no
      Xcode/Android SDK). Steps will be documented in `apps/mobile/README.md`:
      rustup iOS/Android targets, `ubrn` codegen, `pod install`, Expo prebuild.
- [ ] On a Mac: verify the Tauri iOS app still builds from `apps/desktop`
      (Xcode project geometry was preserved in M1, unverified since).

## Milestones

- [x] M1 — monorepo restructure (apps/desktop, npm + cargo workspaces, CI)
- [x] M2 — framework-free core crate `crates/type-core` (AppEnv seam)
- [x] M3 — per-folder `transcription_mode` in `.type/settings.json` +
      pluggable `TranscriptionProvider` port + shared queue helper
- [x] M4 — `crates/type-ffi`: UniFFI (0.31, matches ubrn 0.31.0-3) JSON-facade
      bindings + foreign TranscriptionProvider trait + host e2e test
- [ ] M5 — `packages/shared`: extract platform-free TS from
      `apps/desktop/src/shared/lib` (frontmatter, format/NotePreview,
      annotation-metadata, jobs, domain types); desktop consumes it;
      tsc + vitest green
- [ ] M6 — `apps/mobile` (Expo CNG) + `packages/mobile-core` (ubrn library):
      blank-page capture stack (open → type immediately; swipe up → previous
      note slides away, fresh blank page), feed/folders navigation, plain-text
      editor, git sync screen, expo-audio recording → `save_audio_recording`,
      settings (working folders, transcription mode). Typed CoreApi facade so
      tsc/jest pass without native builds.
- [ ] M7 — docs (AGENTS.md, CLAUDE.md, READMEs) + CI final pass
- [ ] M8 (stretch) — security/PIN surfaces on mobile via FFI lock-screen

## Notes / known issues to raise in the PR

- `git_password` is persisted in plaintext inside the synced notes root via
  `.type/settings.json` (pre-existing behavior, now more visible since the
  file syncs). Consider moving credentials to device-local app config.
- FFI `retrigger_transcription` was intentionally not exposed: core hardwires
  it to local Whisper, which mobile can't run. Mobile re-queues failed notes
  via `queue_recording_transcriptions` / `queue_provider_transcriptions`
  (the scan re-queues `failed` notes).
