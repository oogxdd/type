# AGENTS.md

This document is for AI agents and developers who need to understand and modify this codebase.

## What this app is

A local-first markdown notes app built with Tauri v2 (Rust backend) + React (TypeScript frontend). It runs on desktop (macOS/Windows/Linux) and iOS. Notes are stored as `.md` files in a local folder tree. Optional Git sync pushes/pulls notes across devices — including a one-button local-network server (`git daemon`) for syncing to a phone with no external host. Audio recording is supported, with transcription via a self-provisioning local Whisper on desktop (no manual install) and AssemblyAI on iOS. The app also supports optional at-rest note-body encryption, a lock screen, and panic-password local wipe.

## Tech stack

- **Frontend**: React 19, TypeScript, Vite, Tiptap (editor), DnD Kit (drag-and-drop), Tailwind + Shadcn/ui
- **Backend**: Tauri v2 (Rust), organized as **ports / adapters / commands** (hexagonal) across domains: notes, profiles, security, recordings (+ whisper_env), handwriting, git_sync, local_sync, platform, plus iOS native
- **Build**: `npm run build` runs `tsc && vite build` (plus an OTA asset build). Rust: `cargo check --manifest-path src-tauri/Cargo.toml`

## Backend structure (src-tauri/src/)

The Rust backend uses a **ports / adapters / commands** (hexagonal) layout so the
domain logic can move to another shell (e.g. UniFFI for React Native) without a
rewrite. `src-tauri/README.md` covers the rationale; this is the navigation map.

```
src/
  main.rs              Binary entry point → lib::run().
  lib.rs               Crate root: declares the three layers, glob-re-exports every
                       adapter symbol, and holds shared constants/utilities.
  ports/<domain>.rs    Platform-agnostic contract per domain.
  adapters/<domain>.rs The real Rust implementation (filesystem, git2, crypto, …).
  commands/<domain>.rs Thin #[tauri::command] wrappers that call adapters.
```

**Layer wiring.** `lib.rs` does `pub(crate) use adapters::*;`, so both adapters
and command modules reach shared symbols via `use crate::*;`. The
`generate_handler![]` macro in `commands/mod.rs` uses qualified paths
(`notes::read_note`, `git_sync::git_pull`, …) to disambiguate from the
identically-named adapter modules. Each command is short: unlock-gate the request
with `ensure_security_unlocked_for_app`, then run the adapter call on a blocking
thread via `run_blocking_command`.

### lib.rs — shared hub

- Layer declarations: `pub mod ports;`, `mod adapters; pub(crate) use adapters::*;`, `mod commands;`
- Shared crate re-exports: `BASE64`, `fs`, `HashMap`, `HashSet`, `PathBuf`, `Manager`, git2 types, objc types (iOS)
- Shared constants: `RECORDING_STATUS_PENDING/QUEUED/PROCESSING/COMPLETED/FAILED`
- Shared utilities: `app_data_dir`, `now_ms`, `time_to_ms`, `note_parent_folder_path`, `decode_base64_payload` (+ audio/image variants), `response_error`
- macOS: `MACOS_WINDOW_ALPHA`, `apply_macos_window_alpha`
- Entry point: `pub fn run()` → `commands::run()`

### commands/ — Tauri IPC layer

`commands/mod.rs` holds `run()` (builds the Tauri app, registers plugins, calls
`generate_handler![]`) and the shared `run_blocking_command` helper. One file per
domain, each a set of thin wrappers:

| File | Commands |
|------|----------|
| `security.rs`   | state, enable, lock, unlock, set preferences |
| `platform.rs`   | set native theme, present file-export sheet |
| `profiles.rs`   | profile CRUD, backup zip, export to Documents |
| `notes.rs`      | tree, read/create/write, meta, move/delete/rename, order, timestamp |
| `recordings.rs` | native recorder caps/start/stop, save, queue (AssemblyAI + local Whisper), retrigger, Whisper status, list, read audio |
| `handwriting.rs`| save attachment, queue OCR, list OCR jobs |
| `git_sync.rs`   | SSH key gen/get/delete, status, history, connect, pull, push |
| `local_sync.rs` | local server status/start/stop, discover peers |

### adapters/ — implementations

Key symbols live in `adapters/<domain>.rs`:

- **notes** — filesystem notes, front-matter, tree, ordering. Constants `ORDER_FILE`, `FEED_FOLDER`, `ARCHIEVE_FOLDER`, `RECORDINGS_STORAGE_FOLDER`, `ATTACHMENTS_STORAGE_FOLDER`, `PROTECTED_SYSTEM_FOLDERS`. `parse/render/write_note_with_front_matter`. `allocate_note_file_name` (UTC-slug / uuid_v7 / uuid_v7_prefix_slug) + Unicode-aware `slug_from_content`. `build_folder_node`, `ensure_system_folders`, `migrate_legacy_system_folders`, order helpers, `collect_markdown_note_files`. `ensured_notes_root` resolves the active profile's root.
- **profiles** — `.notes-profiles.json` persistence; legacy `.notes-sessions.json` migration. `ensure_profiles_state`, `find_profile`, the `*_state` CRUD fns, `profile_root_for_id`, `normalize_notes_root_path`, dir copy/move helpers.
- **security** — XChaCha20-Poly1305 at-rest body encryption with an Argon2id-derived key. `SECURITY_RUNTIME` (OnceLock<Mutex>) holds the in-memory key after unlock. `.notes-security.json` config. `encrypt_note_body_for_write`, `decrypt_note_body_for_read`, `ensure_security_unlocked_for_app` (the lock gate most commands call), panic flow `panic_reset_local_data`.
- **recordings** — save audio → note with metadata. `TRANSCRIPTION_QUEUE` worker drives AssemblyAI (cloud, used on iOS) and the local Whisper path (desktop, via `whisper_env`). `collect_recording_notes`, queue snapshot for the UI, `check_whisper_availability`.
- **whisper_env** — desktop only. Provisions and owns an isolated CPython + faster-whisper under app-data using [`uv`](https://docs.astral.sh/uv/) (downloading `uv` itself on first use if absent), so the user installs nothing. `whisper_env_ready`, `managed_python`, `ensure_whisper_env`.
- **handwriting** — save image attachment → note; `HANDWRITING_OCR_QUEUE` worker. Providers `HandwritingOcrProvider::OpenAi` (GPT-4o) and `::HuggingFace` (503 retry). `collect_handwriting_notes`.
- **git** (the `git_sync` domain) — libgit2 sync. `ensure_git_repo`/`open_repo`, `perform_fetch`/`fast_forward_to`/`merge_fetched_commit`/`commit_all_changes`, `resolve_target_branch`/`switch_or_prepare_branch`. Conflicts keep "ours" and write "theirs" as `.conflict.md` siblings — merge never blocks. `build_git_status`, `build_git_history` (+ `GIT_NOTE_TIMESTAMPS_CACHE`). `build_callbacks` auth order: app SSH key file → SSH agent → username/password. Ed25519 keypair under `<app_data_dir>/ssh/`. Bootstrap-artifact detection for first sync.
- **local_sync** — desktop hosts a `git daemon` over plain `git://` so a phone on the same Wi-Fi / hotspot can push/pull with no external host. Supervises the child in a process-global `Mutex<Option<RunningDaemon>>` (idempotent start, reaps dead handles, killed on app exit). `receive.denyCurrentBranch=updateInstead` lets phone pushes update the live working tree. Detects the outbound LAN IP via a connected UDP socket; advertises/browses the `_typenotes-sync._tcp` mDNS service for tap-to-discover. See `docs/LOCAL_SYNC.md`.
- **ios** (`#[cfg(target_os = "ios")]`) — native AVAudioRecorder/AVAudioSession recording and WKWebView termination recovery via Objective-C interop. State in `IOS_NATIVE_RECORDER`, `IOS_WEBVIEW_TERMINATION_PROXIES`.

### ports/ — contracts

Each `ports/<domain>.rs` is documentation-first: the `Serialize` DTOs, a trait
naming the operations, and an "Implementation Notes" block spelling out the
inputs, outputs, and invariants of every operation. They are the spec a future
non-Tauri shell (UniFFI) would re-implement, so keep them in sync with adapter
behavior when a contract changes. (The adapters currently provide behavior as
free functions rather than `impl Trait`, so the traits read as the contract, not
a compile-time constraint.)

### Cross-domain dependencies & visibility

```
lib.rs (shared utils) ← everything
profiles       ← security (panic reset, enable migration)
profiles       ← notes    (notes_root resolution)
notes          ← security (encrypt_note_body_for_write)
notes          ← recordings / handwriting (front matter, file naming, collection)
git/local_sync ← notes (notes_root) + git helpers (repo/branch)
```

Circular references (security↔notes, profiles↔notes) are fine — one crate, all
resolved via `crate::` paths. Symbols used outside their module are `pub(crate)`;
module-internal helpers stay private.

## System folders and storage

- Profile notes root is configurable per profile (`notes_root`). It can live in app data or any user-selected absolute path.
- Required system folders inside each `notes_root`:
  - `Feed` — default notes folder
  - `Archieve` — archive folder (typo is intentional and persisted)
  - `Recordings` — audio file storage folder
- `Recordings` is hidden from folder tree/navigation and used as backend storage.
- Legacy migrations are handled by backend:
  - `Unsorted` -> `Feed`
  - `_Recordings` -> `Recordings`
- `Feed` does not keep `.notes-order.json`.

## Security and encryption

- Security config is persisted in app data as `.notes-security.json` (not inside notes roots).
- When encryption is enabled:
  - note **body** content is encrypted at rest (`XChaCha20-Poly1305` envelope)
  - filenames and frontmatter remain plaintext by design
  - app starts locked by default and backend content commands reject requests until unlock
- Password handling:
  - unlock + panic passwords are Argon2id-hashed
  - unlock password derives an in-memory data key (never persisted in plaintext)
- Panic flow:
  - entering panic password on lock screen triggers backend local wipe
  - notes/profile/security files are reset
  - backend seeds 3 dummy notes in `Feed`
  - frontend clears localStorage and reloads

## How the frontend is structured

The frontend is **feature-sliced**. Cross-cutting state lives in `contexts/`, IPC in
`data/`, shared design-system primitives in `components/ui/`. Each user-facing feature
owns its components + hooks + utils together under `features/<name>/`. The two platform
presentations are thin composition shells in `desktop/` and `mobile/`.

Imports use the `@/` → `src/` alias for cross-directory references (configured in
`tsconfig.json`, `vite.config.ts`, and `vite.ota.config.ts`); same-folder and
intra-feature imports stay relative.

```
src/
  main.tsx, ota-bootstrap.ts   entry stubs — ota-bootstrap.ts is the index.html entry;
                               main.tsx is the OTA bundle entry (see vite.ota.config.ts).
                               Both call mountApp() from app/main-app.
  app/                         composition root: app, app-shell, main-app,
                               error-boundary, launch-screen, app.css
  contexts/                    cross-cutting React state (*-context.tsx)
  data/                        Tauri IPC wrappers (*-api.ts, invoke.ts)
  components/ui/               shadcn/ui primitives
  lib/utils.ts                 cn() helper
  hooks/use-mobile.ts          shadcn breakpoint hook (used by components/ui/sidebar)
  utils/                       cross-cutting helpers (dom, format, frontmatter,
                               jobs, notes, selection, storage)
  types.ts, constants.ts       global types / constants
  features/
    tree/        folder navigation tree + DnD + keyboard nav
    editor/      note editor, multi-note lens, recording/handwriting headers
    notes/       note-list row + previews
    settings/    section registry + desktop/ and mobile/ UI variants
    security/    lock screen
    recording/   audio recorder hook
  desktop/       desktop composition shell (shell + 3 panes + sidebar)
  mobile/        mobile composition shell (shell, tablet-layout, hooks/, ui/,
                 views/, screens/)
```

### Provider tree (`src/app/app.tsx`)

`app.tsx` is a thin composition layer. All state lives in React contexts:

```
ErrorBoundary                 — app-root crash guard; renders a recoverable fallback
  ThemeProvider               — theme mode, notes list mode, editor font size
    SecurityProvider          — security state, unlock/lock/enable, auto-lock preference
      SecurityGate            — renders lock screen when encrypted state is locked
        ProfilesProvider      — profile list, active profile, per-profile sync settings
          GitSyncProvider     — git status, connect/pull/push operations, commit history (git log)
            SelectionProvider — folder/note selection state, mobile selection helpers
              EditorProvider  — note editor state (wraps useNoteEditor hook)
                NotesTreeProvider — folder tree, CRUD operations, rename
                  RecordingsProvider  — audio recording, transcription queue, playback
                    HandwritingProvider — image import, OCR queue (OpenAI / HuggingFace)
                      AppShell  — UI rendering, DnD wiring, keyboard shortcuts
```

### app-shell.tsx (`src/app/app-shell.tsx`)

Orchestrates desktop-specific behavior. Owns local UI state: `appMode` (notes/settings), `sidebarCollapsed`, pane sizes, settings section. Renders either `DesktopShell` (`src/desktop/desktop-shell.tsx`) or `MobileShell` (`src/mobile/mobile-shell.tsx`) depending on viewport. Wires up `useDragDrop()` and `useKeyboardNavigation()` (both from `features/tree/`). Contains folder/note click handlers and context-menu setup. Desktop pane content is delegated to `DesktopMiddlePane` / `DesktopRightPane` (`src/desktop/middle-pane.tsx`, `src/desktop/right-pane.tsx`). Uses `SecurityContext.lockSecurity()` for the global lock shortcut (`Cmd/Ctrl+Shift+L`).

All child components consume contexts directly — no prop drilling. `MobileShell` receives only 3 props.

### Contexts in detail (`src/contexts/`, kebab-cased files)

**ThemeContext** (`theme-context.tsx`): Persists theme and notesListMode to localStorage. Toggles `document.documentElement` dark class. Provides font size controls (increase/decrease/reset with min 12, max 28).

**SecurityContext** (`security-context.tsx`): Loads security state from backend (`get_security_state`) and drives lock/unlock/enable flows. Exposes `enableSecurity`, `unlockSecurity`, `lockSecurity`, `setAutoLockOnBackground`. Implements client-side panic reset (clears localStorage + reloads when backend reports panic wipe). Auto-locks on `document.visibilitychange` when encryption is enabled and the preference is on.

**ProfilesContext** (`profiles-context.tsx`): Multi-profile support. Each profile has its own `notes_root` and sync settings. Exposes `activeProfileNotesRoot` and `setProfileNotesRoot(profileId, notesRoot)`. `syncSettings` is one object (gitRemoteUrl, gitBranch, gitUsername, gitPassword, gitCommitMessage, lastSuccessfulSyncAt, assemblyAiApiKey, mobileAutoTranscriptionEnabled) persisted to localStorage keyed by profile ID. Takes a `flushSaveRef` prop to flush the editor before profile switching or path migration.

**GitSyncContext** (`git-sync-context.tsx`): Reads sync settings from ProfilesContext. Manages git status polling and connect/pull/push. Exposes `gitCommitHistory` (from `get_git_history`) + `refreshGitHistory()`. `gitPull` accepts an optional `onAfterPull` callback (used to refresh the tree after pull).

**SelectionContext** (`selection-context.tsx`): Owns folder/note selection state (`selectedFolders`, `selectedNotes`, `activeFolder`, `activeNote`, `lastSelectedFolder`, `lastSelectedNote`) + setters. Mobile helpers: `selectFolderForMobile`, `selectNoteForMobile`, `enterMobileHome`. Resets selection when `activeProfileId`/`activeProfileNotesRoot` change. Consumed by most UI and by NotesTreeContext for CRUD-driven selection updates.

**EditorContext** (`editor-context.tsx`): Wraps the `useNoteEditor` hook (`features/editor/use-note-editor.ts`), providing `noteContent`, `draftNoteContent`, `handleEditorChange`, `isSaving`, `lastSaveError`, `flushSave`, `clearNote`, `clearDraft`, `retrySave`. Owns `rightPaneRef`. Watches `activeNote` to load/save notes; handles flush-on-visibility/unload; clears on profile/root change.

**NotesTreeContext** (`notes-tree-context.tsx`): Owns the folder tree, computed tree data (treeData, flatItems, visibleItems, orderedIds), and rename state. Provides all CRUD: createNewNote, deleteNotes, deleteFolders, moveNotesToArchive, rename. New notes use the per-profile filename mode (`utc_timestamp_slug`, `uuid_v7`, `uuid_v7_prefix_slug`). Consumes SelectionContext and EditorContext to update them after CRUD. Resets on profile/root change.

**RecordingsContext** (`recordings-context.tsx`): Wraps `useAudioRecorder` (`features/recording/use-audio-recorder.ts`). Manages recording target folder, recording list/queue polling, audio playback (blob URLs), auto-queue transcription timer. Takes `onRecordingComplete` (wired in `app.tsx`) to refresh the tree and select the new note.

**HandwritingContext** (`handwriting-context.tsx`): Image import + OCR queue (OpenAI / HuggingFace), wired similarly to recordings.

### Cross-context bridges

These are the trickiest part of the architecture (all in `src/app/app.tsx`):

1. **SecurityGate**: Keeps provider-heavy app state unmounted while locked, preventing data fetches when encrypted mode is locked.
2. **FlushSaveBridge**: Tiny component that reads `flushSave` from EditorContext and writes it into ProfilesProvider's `flushSaveRef`, so profile switching can flush unsaved editor content.
3. **RecordingsProvider.onRecordingComplete**: Defined in `AppInner`; on recording finish it refreshes the tree (NotesTreeContext) and selects the new note (SelectionContext).
4. **GitSyncContext.gitPull({ onAfterPull })**: app-shell passes `() => refreshTree()` so the tree reloads after a pull.
5. **NotesTreeContext → SelectionContext/EditorContext**: CRUD ops update selection and editor state.

### Feature: tree (`src/features/tree/`)

- `folders-panel.tsx` — top-level folders panel: tree rendering, recent section, "new folder" button, drop zones. Exports `EdgeSnap`, `DROP_PREFIX`, `dropId`, `ROOT_ID`.
- `tree-node.tsx` — recursive folder node (renders `tree-row` + child `nav-note-row`s + subfolders).
- `tree-row.tsx` — single folder row: drag-drop, rename input, expand/collapse, tree guides, note-count badge.
- `nav-note-row.tsx` — note row inside the folder tree (nested-notes navigation mode).
- `recent-tree-node.tsx` — recursive node for the "Recent" tab (time-based buckets).
- `use-drag-drop.ts` — all DnD Kit handlers (folder reorder w/ edge-snap + auto-expand, note reorder/move). Tree state passed in as params for testability.
- `use-keyboard-navigation.ts` — global shortcuts (Cmd+T/W/J/K/N, font zoom, lock) + arrow-key folder/note navigation, including the nested-notes mode.
- `tree-ops.ts` — tree build/flatten/find/insert/remove/reorder.
- `dnd-tree.ts` — DnD sortable-tree projection/flatten helpers.
- `keyboard-coordinates.ts` — sortable keyboard coordinate getter (currently unused; the DnD context uses only PointerSensor).
- `types.ts` — `TreeItem` (DnD tree node), `FlattenedItem` (flattened for rendering).

### Feature: editor (`src/features/editor/`)

- `note-editor.tsx` — Tiptap editor; shared by desktop and mobile.
- `multi-note-lens.tsx` + `note-readonly-content.tsx` — desktop multi-note "lens" view.
- `recording-note-header.tsx`, `handwriting-note-header.tsx` — note headers (shared).
- `use-note-editor.ts` — loads note content on `activeNote` change, flushes previous if dirty, debounced autosave (400ms), dirty/saving/error state, `flushSave()`. On switch: empty dirty notes auto-delete; placeholder filenames auto-rename to `...-<slug>.md` when content allows (mode-dependent).
- `markdown-editor.ts` — markdown ↔ HTML conversion. `lens-backmatter.ts`, `note-annotations.ts` — annotation/backmatter helpers.

### Feature: notes (`src/features/notes/`)

- `note-row.tsx` — desktop middle-pane note row.
- `use-note-previews.ts` — given `NoteEntry[]`, fetches each note's meta + content in parallel, returns previews (title, date, summary).

### Feature: settings (`src/features/settings/`)

- `sections.ts` — `SettingsSectionId` + `SETTINGS_SECTIONS` registry. **Single source** for section ids, consumed by both shells.
- `use-settings-data.ts` — shared computed values for settings UI (`isRecordingBusy`, `syncActionLabel`, `canPull/Push/Connect/Queue`, `recorderState`, `playButtonText()`).
- `desktop/` — `settings-panel.tsx` (SettingsMiddlePane + SettingsDetailPane), 8 section components (general, profile, sync, updates, appearance, transcription, recordings, security) + `local-sync-server-card.tsx`. `profile-section.tsx` has the SSH-key UI (generate/copy/delete Ed25519).
- `mobile/` — `settings-screen.tsx` (tabs + section switcher), 7 sections (no `transcription`), `helpers.tsx` (Group/ChoiceRow/InputRow/StatRow). `profile-section.tsx` has the SSH-key UI.

### Feature: security (`src/features/security/`)

- `lock-screen.tsx` — the unlock screen rendered by `SecurityGate` while encrypted-and-locked.

### Feature: recording (`src/features/recording/`)

- `use-audio-recorder.ts` — dual-mode: Web MediaRecorder (desktop) / native iOS via Tauri commands. Recovers when native recording survives app backgrounding.

### Hooks (`src/hooks/`)

- `use-mobile.ts` — shadcn breakpoint hook (used by `components/ui/sidebar.tsx`). Every other hook now lives with its feature: `use-drag-drop` / `use-keyboard-navigation` → tree, `use-note-editor` → editor, `use-note-previews` → notes, `use-audio-recorder` → recording, `use-settings-data` → settings, `use-edge-swipe` → `mobile/hooks/`.

### Data layer (`src/data/`)

`notes-api.ts` wraps all Tauri IPC commands (1:1 with Rust commands; re-implement these exports to swap backends). Key commands: `getTree`, `readNote`, `createNote`, `writeNote`, `getNoteMeta`, `deleteItems`, `moveItems`, `renameItem`, `setOrder`, `getGitStatus`, `getGitHistory`, `connectGitRepo`, `gitPull`, `gitPush`, `generateSshKey`, `getSshPublicKey`, `deleteSshKey`, `getProfiles`, `setActiveProfile`, `createProfile`, `setProfileNotesRoot`, `listRecordings`, `saveAudioRecording`, `queueRecordingTranscriptions`, `readRecordingAudio`, `startNativeAudioRecording`, `stopNativeAudioRecording`, `nativeRecorderCapabilities`, `getSecurityState`, `enableSecurity`, `lockSecurity`, `unlockSecurity`, `setSecurityPreferences`. `git-api.ts` also exposes the SSH key lifecycle. `invoke.ts` holds the shared `invokeLogged` wrapper.

### Layout modes

| Mode | Breakpoint | Shell | Notes panel |
|------|-----------|-------|-------------|
| phone | < 768px | MobileShell | Stack navigation |
| tablet | 768–1024px | MobileShell | Split view |
| desktop | > 1024px | DesktopShell | Resizable three-pane |

Detection in `src/mobile/use-layout-mode.ts`.

### Types

`src/types.ts`: FolderNode, NoteEntry, GitSyncStatus, GitCommitHistoryEntry, ProfileSyncSettings, RecordingListItem, RecordingQueueSnapshot, AppMode, PaneId, GitSyncAction, VisibleNavigationItem, `SecurityState`, `SecurityUnlockResult`, plus `ThemeMode` and `NotesListMode` (cross-cutting — moved here from the old SettingsPanel).

`src/features/tree/types.ts`: TreeItem (DnD tree node), FlattenedItem (flattened for rendering).

### Desktop shell (`src/desktop/`)

- `desktop-shell.tsx` — lightweight wrapper for the 2-pane / 3-pane resizable layout.
- `middle-pane.tsx` — notes list (`SortableContext` + `note-row`) or `SettingsMiddlePane`, by `appMode`.
- `right-pane.tsx` — editor (`note-editor` / `multi-note-lens`) or `SettingsDetailPane`, by `appMode`.
- `app-sidebar.tsx` — desktop left rail (feed / new note / record / handwriting / settings / trash).

### Mobile shell (`src/mobile/`)

- `mobile-shell.tsx` — thin shell: wires navigation/action-sheet/edge-swipe hooks; renders the phone layout (nav bar + route renderer + drawer) or the tablet layout, plus action-sheet / prompt / toast overlays. Only 3 props from app-shell.
- `tablet-layout.tsx` — tablet two-pane layout (left: folders or settings sections; right: notes+editor or settings detail).
- `navigation.ts` — route types + `useReducer` navigation state machine. `types.ts` — mobile constants (`FEED_FOLDER_PATH`, `ARCHIVE_FOLDER_PATH`, `SYSTEM_FOLDER_PATHS`) + helpers (`getDisplayFolderName`, `getDisplayRouteTitle`).
- `use-layout-mode.ts`, `use-keyboard-insets.ts`.
- `hooks/` — `use-mobile-navigation`, `use-action-sheets`, `use-phone-nav-header`, `use-recent-buckets`, `use-edge-swipe`.
- `ui/` — UI primitives: `action-sheet`, `nav-bar`, `tab-bar`, `prompt-sheet`, `toast`.
- `views/` — reusable screen bodies used by both phone screens and the tablet layout: `folders-view`, `notes-view`, `editor-view`, `recent-view`, `recording-view`.
- `screens/` — one phone route screen per `route.kind`: `home-screen`, `folders-screen`, `notes-screen`, `recent-date-screen`, `recording-screen`, `editor-screen`, `settings-screen`, plus `index.tsx` (`PhoneRouteRenderer` dispatch).

## iOS Widget (Quick Record)

A WidgetKit extension that lets users start a recording from the iOS home screen or lock screen.

### How it works

1. **Widget extension** (`src-tauri/gen/apple/type-widget/RecordWidget.swift`): A `systemSmall` StaticConfiguration widget showing a mic icon and "New Recording" label. The entire widget surface links to `type2://record`.

2. **URL scheme**: The `type2://` custom URL scheme is registered in `project.yml` via `CFBundleURLTypes`. When the widget is tapped, iOS opens the app with `type2://record`.

3. **Deep link handling** (`src/mobile/mobile-shell.tsx`): A `useEffect` imports `@tauri-apps/plugin-deep-link` and listens for URL open events. When a URL containing "record" is received, it calls `openRecordingRoute` with `autoStart: true`.

4. **Auto-start recording** (`src/mobile/views/recording-view.tsx`): When the `autoStart` prop is true and recording is supported/idle, recording begins automatically via a one-shot `useEffect` (guarded by a ref to prevent re-firing).

### Files

- `src-tauri/gen/apple/type-widget/RecordWidget.swift` — Widget SwiftUI code
- `src-tauri/gen/apple/type-widget/Info.plist` — Widget extension plist
- `src-tauri/gen/apple/project.yml` — `type_RecordWidget` target + `CFBundleURLTypes` on `type_iOS`
- `src-tauri/Cargo.toml` + `src-tauri/src/lib.rs` — `tauri-plugin-deep-link` registration
- `src/mobile/navigation.ts` — `autoStart` field on recording route
- `src/mobile/mobile-shell.tsx` — Deep link listener + passes autoStart through
- `src/mobile/views/recording-view.tsx` — Auto-start behavior

## Gotchas

- **"Archieve" typo**: The archive folder is spelled "Archieve" in the codebase and in persisted data. Do not "fix" this — it would break existing user data.
- **Feed folder semantics**: `Feed` is the default notes folder and does not keep `.notes-order.json`.
- **Recordings storage**: audio files live under hidden `Recordings/`; notes created from recordings can be in `Feed` or the selected folder and reference audio via frontmatter.
- **Filename lifecycle**: per-profile setting controls new note file names:
  - `utc_timestamp_slug` (default): `YYYY-MM-DDTHH-mm-ssZ-<slug>.md`
  - `uuid_v7`: `<uuidv7>.md` (no auto-rename to slug)
  - `uuid_v7_prefix_slug`: `<uuidv7-prefix>-<slug>.md`
  New notes may start with placeholder suffixes (`-note-...`, `-recording-...`, etc.) and then auto-rename to content slug when enough text is available in slug-capable modes. Slug extraction is Unicode-aware (keeps Cyrillic/Latin letters and digits) and ignores `NV_EMPTY_LINE_TOKEN_*` noise.
- **Empty note cleanup**: if a dirty note is emptied and then focus/selection moves away, it is auto-deleted.
- **Git sync uses libgit2**, not shell git. The Rust backend handles all git operations.
- **Git server support is generic**: `git://`, `ssh://`, and `https://` remotes are all supported. See `docs/ssh-sync-setup.md` for SSH sync setup with key-based auth.
- **SSH key auth**: The app can generate and store an Ed25519 keypair in `<app_data_dir>/ssh/`. When an SSH key exists, all git operations (connect/push/pull) use it automatically before falling back to SSH agent or username/password.
- **Merge conflict resolution**: Conflicts during pull are resolved by keeping the local version and saving the remote version as a `.conflict.md` sibling file (e.g., `note.md` + `note.conflict.md`). The merge always completes — sync is never blocked by conflicts. Users resolve manually and delete the `.conflict.md` file when done.
- **Lock guard is backend-enforced**: most app commands return a locked error while encrypted mode is locked; only security commands remain callable.
- **Encryption scope is note body only**: recordings/attachments are currently stored unencrypted.
- **Sync history UX**: settings now show commit history from real git log. This cannot reliably encode which device performed push/pull for every commit.
- **Editor saves are debounced** (400ms). `flushSave()` must be called before navigation away, profile switching, or app backgrounding.
- **`shouldNestNotesInNavigation`**: When `notesListMode === "nested"`, notes appear inline inside the folder tree instead of in a separate middle pane. This affects keyboard navigation, rendering, and the visible navigation items computation.
- **Context split ordering matters**: SelectionContext and EditorContext are above NotesTreeContext in the provider tree. NotesTreeContext consumes both to update selection/editor after CRUD ops. Don't reorder providers without understanding these dependencies.
