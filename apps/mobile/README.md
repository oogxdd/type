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
to stop. Long-press the mic to reveal camera and photo-library actions for a
handwritten page. The phone saves the image-backed note as `ocr_status:
pending`; a synced desktop performs recognition.

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
2. Prebuild and run. `ubrn` overwrites the stable package entry with the real
   TurboModule; `src/core/boot.ts` needs no manual edit:

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
  theme.ts                the useTheme hook (system scheme + appearance prefs)
  core/boot.ts            wires RawCore (generated native module or mock) + initCore
  lib/appearance.ts       palette + theme derivation (pure, tested)
  lib/capture.ts          capture-page note lifecycle (pure, tested)
  lib/feed.ts             tree+previews → list rows (pure, tested)
  lib/folder-tree.ts      folder tree → flat expandable rows (pure, tested)
  lib/capture-gesture.ts  swipe thresholds + decisions (pure, tested)
  state/                  zustand stores: notes (incl. move/delete/archive),
                          settings (working folders), sync, appearance
                          (device-local, no core)
  screens/                capture, menu, feed, folder, editor, sync, settings
  ui/                     dictation/photo capture button, audio player, note
                          actions sheet + folder picker + selection mode
                          (note-organizer), shared primitives
```

Notes are organized from any list: hold a row for archive / move / delete, or
"Select more…" for a batch. Moving to a path that does not exist creates it —
the core has no separate create-folder command.

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

## Appearance

Settings → Appearance picks a background, a text color, and the editor text
size. These are **device-local**: they persist to `appearance.json` beside
the core's app data (never inside a notes root), so they cannot reach a
notes root and cannot sync to another device — one phone can be sepia while
the desktop stays light.

`theme.ts` derives the whole palette from those two colors rather than
switching between fixed light/dark tables: the background's luminance
decides the dark variant (status bar, keyboard appearance), and surface,
border, and secondary text are blends of the background, so a custom color
still yields a coherent theme. `readableOn` in `lib/appearance.ts` enforces
a WCAG-AA floor on the body text/background pair — without it, picking
white-on-white would leave the user unable to read the screen that undoes
it. Text size applies to the capture page and the note editor only.

## Handwriting photos

Camera and gallery photos use `saveHandwritingAttachment` through the same
UniFFI/typed-core boundary as recordings. This creates a note that points to a
file under `Attachments/` and remains pending on mobile. Desktop scans pending
handwriting notes after sync and dispatches them to the selected local or cloud
OCR provider. See `docs/ATTACHMENT_RETENTION.md` before adding device cleanup:
removing a tracked attachment directly would sync that deletion to desktop.
