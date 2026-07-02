# React Native monorepo — working TODO

Branch: `feat/react-native-monorepo`. This file tracks in-flight work and
deferred checks (the dev VM is slow, so full builds are delegated to CI).
Delete this file when the branch is ready for review.

## Deferred verification (do before merging)

- [ ] Full `cargo check --workspace` + `cargo test --workspace --lib` after M4
      (type-ffi crate added). Killed locally to save time — desktop crate does
      not depend on type-ffi, so risk is low. **CI on push covers this.**
- [ ] Confirm CI is green on the branch (typescript + rust jobs). Note: CI
      triggers on PRs and main pushes only — open a (draft) PR for the branch
      to get per-push CI.
- [ ] `npm run build` (desktop vite + OTA) after the M5 shared-package
      refactor. Branch CI does NOT cover this (deploy-pages builds only on
      main); typecheck + vitest are green locally, but rollup's resolution of
      the `@typenotes/shared/*` exports map is unverified until a build runs.
- [ ] Local quirk: vitest's default parallel pool segfaults on this dev VM.
      Run `vitest run --no-file-parallelism` locally; CI is unaffected.
- [ ] On a Mac: iOS/Android native builds of the RN app (this VM has no
      Xcode/Android SDK). Steps documented in `apps/mobile/README.md` and
      `packages/mobile-core/README.md`: rustup iOS/Android targets, `ubrn`
      codegen (0.31.0-3), wire the generated module in
      `apps/mobile/src/core/boot.ts`, Expo prebuild, pod install. Also verify
      the exact generated TS surface matches `raw-core.ts` (names are the
      uniffi camelCase convention; adjust the seam if anything drifts).
- [ ] On a Mac: verify the Tauri iOS app still builds from `apps/desktop`
      (Xcode project geometry was preserved in M1, unverified since).

## Milestones

- [x] M1 — monorepo restructure (apps/desktop, npm + cargo workspaces, CI)
- [x] M2 — framework-free core crate `crates/type-core` (AppEnv seam)
- [x] M3 — per-folder `transcription_mode` in `.type/settings.json` +
      pluggable `TranscriptionProvider` port + shared queue helper
- [x] M4 — `crates/type-ffi`: UniFFI (0.31, matches ubrn 0.31.0-3) JSON-facade
      bindings + foreign TranscriptionProvider trait + host e2e test
- [x] M5 — `packages/shared` (`@typenotes/shared`): platform-free TS shared by
      both apps — domain `types`, `frontmatter`, `format` (NotePreview),
      `annotation-metadata` + `lens-backmatter`, `jobs`, `errors`, pure tree
      walkers (`notes`), system-folder `constants`. TS source is exported
      directly (`"./*": "./src/*.ts"` — internal-package pattern; Vite, tsc,
      and Metro all consume it, no build step). Desktop imports via
      `@typenotes/shared/<module>`; browser-only helpers (yieldToUi, base64,
      DOM/storage/selection) stayed in `apps/desktop/src/shared`.
- [x] M6 — `apps/mobile` (Expo SDK 57, RN 0.86) + `packages/mobile-core`:
      blank-page capture stack (open → type immediately; swipe up → page files
      itself, fresh blank page), feed/folders navigation, plain-text editor
      with debounced saves + flush-on-leave, git sync screen (status, connect,
      pull/push, SSH key, history), expo-audio recording →
      `save_audio_recording` + mode-dependent queueing, settings (working
      folders incl. notes-root move, transcription mode, AssemblyAI key).
      mobile-core ships the RawCore seam + typed core-api + in-memory mock
      (demo mode), so tsc/vitest/Expo Go need no native build. Native module
      generation (ubrn) is a documented Mac step; wiring the generated module
      + a native TranscriptionProvider registration remain Mac-side work.
- [ ] M7 — docs (AGENTS.md, CLAUDE.md, READMEs) + CI final pass
- [x] M8 (stretch) — mobile lock screen over the security FFI: boot checks
      `get_security_state` and gates the whole UI while encrypted + locked
      (content stores load only after unlock, matching the backend gate),
      unlock/panic handled like desktop (panic wipes + reseeds), optional
      auto-lock on background via AppState. Enabling encryption remains a
      desktop-side action for now.

## Notes / known issues to raise in the PR

- `git_password` is persisted in plaintext inside the synced notes root via
  `.type/settings.json` (pre-existing behavior, now more visible since the
  file syncs). Consider moving credentials to device-local app config.
- FFI `retrigger_transcription` was intentionally not exposed: core hardwires
  it to local Whisper, which mobile can't run. Mobile re-queues failed notes
  via `queue_recording_transcriptions` / `queue_provider_transcriptions`
  (the scan re-queues `failed` notes).
