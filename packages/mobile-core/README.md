# @typenotes/mobile-core

The React Native app's bridge to the shared Rust core (`crates/type-ffi`,
UniFFI bindings over `crates/type-core`).

## How it fits together

```
apps/mobile  ──imports──▶  core-api.ts   (typed facade, JSON marshalling)
                              │
                              ▼
                          raw-core.ts    (RawCore interface + setRawCore seam)
                              ▲
              ┌───────────────┴────────────────┐
   src/generated/* (ubrn codegen,       mock-core.ts (in-memory,
   real Rust core — Mac build only)     demo mode / tests / Expo Go)
```

- **`src/core-api.ts`** — what the app imports. Typed functions
  (`getTree(): Promise<FolderNode>`, `gitPush(args)`, …) that serialize to the
  same serde JSON the desktop Tauri commands use (types from
  `@typenotes/shared/types`).
- **`src/raw-core.ts`** — the `RawCore` interface mirroring the UniFFI exports
  one-to-one, plus `setRawCore()`. The app wires an implementation at startup.
- **`src/mock-core.ts`** — in-memory `RawCore` used by tests and as demo mode
  when the native module isn't linked. Nothing persists.
- **`src/index.tsx`** — committed package-root fallback that exports a seeded
  mock in clean clones/CI/Expo Go. Native ubrn codegen overwrites this file
  with the real TurboModule entry on a Mac.

This layout keeps `tsc`, `vitest`, and Expo Go working with **no native
builds** — the generated turbo module is only required for a real device build.

## Generating the native module (Mac only)

Prerequisites: Xcode (+ `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`),
and/or Android Studio + NDK (+ `rustup target add aarch64-linux-android armv7-linux-androideabi`).

```sh
# One-time, in this package. --no-save on purpose: the tool is Mac-only,
# declaring it would make every Linux/CI npm install pull it in.
npm install --no-save uniffi-bindgen-react-native@0.31.0-3

npm run codegen:ios          # simulator slices only — the fast default
npm run codegen:ios:device   # device + simulator (needed for `expo run:ios --device`)
npm run codegen:android
```

`codegen:ios` builds `--sim-only`, so the resulting xcframework has no device
slice — rerun `codegen:ios:device` before installing on a physical phone.
From the repo root, `npm run mobile:ios` chains `codegen:ios` + `expo run:ios`
(the full "Rust changed, rebuild the dev client" one-liner).

This produces `src/generated/` (TS bindings), `cpp/generated/` (JSI glue),
the `ios/` / `android/` library projects, and overwrites the package-root
`src/index.tsx` fallback with the real TurboModule entry. `boot.ts` imports
that stable package root in both modes.

The generated function names match `RawCore` (uniffi camelCases the Rust
snake_case exports). If a signature drifts after changing `crates/type-ffi`,
update `raw-core.ts` and `core-api.ts` to match — the desktop commands and
`crates/type-ffi/src/tests.rs` are the source of truth for the JSON shapes.

Generated output is gitignored; regenerate after every `crates/type-ffi`
change. Finally run `npx pod-install` in `apps/mobile/ios` after an Expo
prebuild (see `apps/mobile/README.md`).

## Transcription providers

`queueProviderTranscriptions(provider)` passes a host-side implementation of
the FFI foreign trait to the Rust queue worker — this is how native on-device
speech recognition plugs in without touching core:

```ts
await queueProviderTranscriptions({
  id: () => "apple-speech",
  transcribe: (audioPath) => recognizeWithSFSpeech(audioPath),
});
```

Use it when the active working folder's `transcription_mode` is `"native"`.
`"assemblyai"` uses `queueRecordingTranscriptions()` (cloud); `"desktop"`
leaves recordings `pending` so a synced desktop transcribes them with local
Whisper; `"off"` never queues automatically.
