# Type — mobile (React Native / Expo)

The React Native version of Type. Same Rust core as the desktop app
(`crates/type-core` via `crates/type-ffi`), same on-disk format, same git
sync — a folder of markdown files with front matter, `Feed`/`Archieve`
system folders, and per-folder `.type/settings.json`.

## The one interaction that matters

The app opens on a **blank page** — start typing immediately. **Swipe up**
and the page files itself into Feed while a fresh blank page slides in
underneath. **Swipe from the left edge** (or tap the hamburger) and the menu
slides in — feed and folders on top, sync and settings at the bottom; swipe
left from the menu's right edge or tap close to return to a fresh blank page. The floating mic
button in the bottom-right dictates a voice note: tap to start and tap again
to stop, or hold it to record only while pressed.

## Running it

### Demo mode (no native build — works anywhere, including Expo Go)

```sh
npm install            # at the repo root (npm workspaces)
npm run start -w @typenotes/mobile
```

Without the generated native module the app boots against an in-memory mock
core (`@typenotes/mobile-core/mock-core`): fully interactive, nothing
persisted, banner at the bottom. UI work and the vitest suites never need a
native build.

### Real build (Mac)

1. Generate the native core module — see `packages/mobile-core/README.md`
   (ubrn codegen + iOS/Android Rust builds).
2. Wire it in `src/core/boot.ts` (uncomment the generated-module import).
3. Prebuild and run:

```sh
npm run prebuild -w @typenotes/mobile    # expo prebuild → ios/ + android/
npm run ios -w @typenotes/mobile         # or: npm run android -w @typenotes/mobile
```

The iOS app's Documents directory is user-visible in the Files app
(`UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace`), so working
folders created under it can be browsed, backed up, and pointed at from
other apps. True security-scoped external folders (iCloud Drive etc.) are a
later step.

## Layout

```
src/
  App.tsx                 boot + navigation container + demo banner
  navigation.ts           typed native-stack route table (menu is the root,
                          capture boots pushed on top of it)
  theme.ts                light/dark palette
  core/boot.ts            wires RawCore (generated native module or mock) + initCore
  lib/capture.ts          capture-page note lifecycle (pure, tested)
  lib/feed.ts             tree+previews → list rows (pure, tested)
  state/                  zustand stores: notes, settings (working folders), sync
  screens/                capture, menu, feed, folder, editor, sync, settings
  ui/                     dictation button (voice capture), audio player, shared
                          primitives for the utility screens
```

State flows one way: screens → `@typenotes/mobile-core/core-api` (typed
facade over the FFI) → Rust core. Stores cache the tree/previews/status and
re-fetch after mutations. Preview parsing, date labels, sync-error hints,
and frontmatter helpers come from `@typenotes/shared` — the same code the
desktop app uses.

## Transcription

Recordings are saved through the core (note + audio file + front matter,
`transcription_status: pending`), then queued according to the working
folder's `transcription_mode` (`.type/settings.json`, synced with the
notes): `assemblyai` queues cloud transcription from the phone, `desktop`
leaves recordings pending for a synced desktop's local Whisper, `native` is
the hook for an on-device recognizer via `queueProviderTranscriptions`
(provider registration not wired yet), `off` does nothing.
