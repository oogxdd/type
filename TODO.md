# React Native monorepo — working TODO

Branch: `feat/react-native-monorepo`. This file tracks in-flight work and
deferred checks (the dev VM is slow, so full builds are delegated to CI).
Delete this file when the branch is ready for review.

## Deferred verification (do before merging)

- [ ] Manual desktop verification of the recordings/transcription work
      (Whisper streaming progress, asset-protocol audio playback, bulk audio
      import — see `crates/type-core/src/adapters/recordings/`,
      `apps/desktop/src-tauri/src/commands/recordings.rs` +
      `apps/desktop/src/features/recording/`,
      `apps/desktop/src/features/settings/components/desktop/transcription-section.tsx`).
      This Sprite VM is headless — Rust compiles clean (`cargo check` on
      type-core/desktop-tauri/type-ffi) and the frontend typechecks + existing
      vitest suites pass, but nobody has actually run the Tauri app to watch:
      (1) a live percentage during local Whisper transcription instead of the
      old static spinner, (2) instant note switching between two audio notes
      with working `<audio>` playback via `asset://` (and that playback is
      still blocked while locked), (3) picking one-or-several existing audio
      files in Settings → Transcription and getting one note per file, dated
      to the source file's real mtime/birthtime, auto-queued for
      transcription. Also sanity-check the new asset-protocol scope actually
      narrows to `<notes_root>/Recordings` per profile (e.g. switch profiles
      and confirm the old profile's folder is no longer asset-servable).
- [ ] Full `cargo check --workspace` + `cargo test --workspace --lib` after M4
      (type-ffi crate added). Killed locally to save time — desktop crate does
      not depend on type-ffi, so risk is low. **CI on push covers this.**
- [ ] Confirm CI is green on the branch (typescript + rust jobs). Note: CI
      triggers on PRs and main pushes only — open a (draft) PR for the branch
      to get per-push CI.
- [ ] Validate the macOS `codegen` job in
      `.github/workflows/ffi-bindings-check.yml` with a manual run
      (Actions → FFI bindings check → Run workflow). It is a DRAFT: expect
      to tune Xcode/target flags on the first attempt. The cheap `surface`
      job (symbol diff) is already active on PRs.
- [ ] `npm run build` (desktop tsc + vite) after the M5 shared-package
      refactor. Branch CI does NOT cover this; typecheck + vitest are green
      locally, but rollup's resolution of the `@typenotes/shared/*` exports
      map is unverified until a build runs.
- [ ] Local quirk: vitest's default parallel pool segfaults on this dev VM.
      Run `vitest run --no-file-parallelism` locally; CI is unaffected.
- [ ] On a Mac: iOS/Android native builds of the RN app (this VM has no
      Xcode/Android SDK). Steps documented in `apps/mobile/README.md` and
      `packages/mobile-core/README.md`: rustup iOS/Android targets, `ubrn`
      codegen (0.31.0-3), wire the generated module in
      `apps/mobile/src/core/boot.ts`, Expo prebuild, pod install. Also verify
      the exact generated TS surface matches `raw-core.ts` (names are the
      uniffi camelCase convention; adjust the seam if anything drifts).
- [ ] Mobile UX round (2026-07-07) — **on-device** verification on iOS.
      Build + TestFlight upload is done (build `2026070702` v0.1.0, Xcode 26.6,
      uploaded 2026-07-07): `expo install --fix` (aligned expo to 57.0.4;
      expo-speech-recognition@56.0.1 builds fine against SDK 57 / RN 0.86),
      `expo prebuild --clean` (camera + speech-recognition permissions + `type2`
      URL scheme + pods regenerated), archive/export/upload all green. The code
      wiring for the items below is confirmed present; what remains is running
      the TestFlight build on a real phone:
      - SSH key generation now happens in-process (`ssh-key` crate) instead of
        shelling out to `ssh-keygen` — regenerate a key on the phone and
        verify it still authenticates against a real ssh:// remote.
      - `transcription_mode: "native"` now runs expo-speech-recognition
        (file-based SFSpeechRecognizer) through the FFI TranscriptionProvider;
        verify a recording transcribes on-device, and that the JS provider's
        async `transcribe` resolves correctly through the ubrn foreign trait.
      - Sync QR flow end-to-end: desktop Settings → Sync → Start server →
        phone menu → Sync → Scan QR code → Sync now; plus the system-camera
        path (`type2://sync` deep link must open the app on the Sync screen).
      - Drawer navigation (hamburger + left-edge swipe), capture screen
        keyboard (no auto-focus, swipe-down dismiss, swipe-up still files the
        page).
- [ ] `packages/mobile-core/src/index.tsx` is gitignored ubrn output, but
      `apps/mobile/src/core/boot.ts` imports it statically — on machines
      without codegen, `tsc --noEmit` for @typenotes/mobile fails unless a
      local stub exists (this VM keeps an uncommitted typed stub there).
      Consider restoring a committed fallback entry so typecheck works from a
      clean clone.

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
- [x] M7 — docs (AGENTS.md, CLAUDE.md, READMEs) + CI final pass
- [x] M9 — strip mobile/iOS/OTA from the Tauri desktop app (desktop is
      desktop-only now): deleted src/mobile + mobile settings screens + Xcode
      project (gen/apple, widget) + OTA plugin/bootstrap/build config + deep
      links + iOS native recorder/WKWebView shell adapters; recordings are
      web MediaRecorder + always-auto-queue local Whisper; release.yml is
      desktop-only and deploy-pages.yml (OTA CDN) is gone. cargo check -p
      type + tsc + vitest green locally.
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
