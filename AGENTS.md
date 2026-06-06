# AGENTS.md

This document is for AI agents and developers who need to understand and modify this codebase.

## What this app is

A local-first markdown notes app built with Tauri v2 (Rust backend) + React (TypeScript frontend). It runs on desktop (macOS/Windows/Linux) and iOS. Notes are stored as `.md` files in a local folder tree. Optional Git sync pushes/pulls notes across devices — including a one-button local-network server (`git daemon`) for syncing to a phone with no external host. Audio recording is supported, with transcription via a self-provisioning local Whisper on desktop (no manual install) and AssemblyAI on iOS. The app also supports optional at-rest note-body encryption, a lock screen, and panic-password local wipe.

## Tech stack

- **Frontend**: React 19, TypeScript, Vite, Tiptap (editor), DnD Kit (drag-and-drop), Tailwind + Shadcn/ui
- **Backend**: Tauri v2 (Rust), organized as **ports / adapters / commands** (hexagonal) across domains: notes, profiles, security, recordings (+ whisper_env), handwriting, git_sync, local_sync, platform, plus iOS native
- **Build**: `npm run build` runs `tsc && vite build` (plus an OTA asset build). Rust: `cargo check --manifest-path src-tauri/Cargo.toml`
- **Tests**: `npm test` (Vitest — frontend pure logic; co-located `*.test.ts`) and `cargo test --manifest-path src-tauri/Cargo.toml --lib` (Rust unit tests in `#[cfg(test)]` modules). CI (`.github/workflows/ci.yml`) runs both, plus `tsc --noEmit`, on PRs and pushes to main.

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
                       A large domain may instead be a folder module
                       (adapters/<domain>/mod.rs + submodules) — see recordings/,
                       notes/, and profiles/.
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

- **notes** — a folder module (`notes/mod.rs` + `front_matter.rs` + `naming.rs` + `tree.rs`) for filesystem notes, front-matter, tree, ordering. `mod.rs` is the hub: shared constants (`ORDER_FILE`, `FEED_FOLDER`, `ARCHIEVE_FOLDER`, `RECORDINGS_STORAGE_FOLDER`, `ATTACHMENTS_STORAGE_FOLDER`, `PROTECTED_SYSTEM_FOLDERS`) + DTO types + root/path resolution (`ensured_notes_root` resolves the active profile's root, `resolve_path`, `strip_root`), and it re-exports the submodules so the crate-root `notes::*` surface is flat. `front_matter.rs`: `parse/render/write_note_with_front_matter`. `naming.rs`: `allocate_note_file_name` (UTC-slug / uuid_v7 / uuid_v7_prefix_slug) + Unicode-aware `slug_from_content`. `tree.rs`: `build_folder_node`, `ensure_system_folders`, `migrate_legacy_system_folders`, order helpers, `collect_markdown_note_files`.
- **profiles** — a folder module (`profiles/mod.rs` + `state.rs` + `backup.rs`) for multi-profile support. `mod.rs`: `.notes-profiles.json` constants + DTO types + `profiles_file_path`/`profile_root_for_id`. `state.rs`: filesystem discovery, normalization, persistence, legacy `.notes-sessions.json` migration, and the `ensure_profiles_state`/`find_profile`/`*_state` CRUD (+ `normalize_notes_root_path`, dir copy/move helpers). `backup.rs`: profile backup zip + Documents export.
- **security** — XChaCha20-Poly1305 at-rest body encryption with an Argon2id-derived key. `SECURITY_RUNTIME` (OnceLock<Mutex>) holds the in-memory key after unlock. `.notes-security.json` config. `encrypt_note_body_for_write`, `decrypt_note_body_for_read`, `ensure_security_unlocked_for_app` (the lock gate most commands call), panic flow `panic_reset_local_data`.
- **recordings** — a folder module (`recordings/mod.rs` + `whisper.rs` + `assembly.rs`): save audio → note with metadata. `mod.rs` owns the `TRANSCRIPTION_QUEUE` worker (which dispatches to a backend), types, queue state, note scanning, and file naming. The two transcription backends live in their own submodules — `whisper.rs` (desktop, managed-Python `faster-whisper` via `whisper_env`; `check_whisper_availability`, `transcribe_audio_local_whisper`) and `assembly.rs` (AssemblyAI cloud, used on iOS). `collect_recording_notes`, queue snapshot for the UI.
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

The frontend is **feature-sliced**. There are four kinds of place code can live:

- `app/` — the composition root (providers, gates, the orchestrating shell), the
  app-global stores that belong to no single domain (`app/state/`), and the
  orchestration hooks the shell delegates to (`app/hooks/`).
- `shared/` — domain-agnostic building blocks usable by anything: `ui/` (shadcn
  primitives), `lib/` (pure helpers), `api/` (the `invoke` IPC wrapper), `hooks/`,
  `types.ts`, `constants.ts`. **`shared/` is a leaf** — it must not import from `features/`
  (one documented exception, see below).
- `features/<name>/` — one folder per user-facing domain. Each owns its code in
  **segments**: `components/` (`.tsx`), `hooks/` (React hooks *and* context providers),
  `lib/` (pure helpers), `api/` (Tauri IPC wrappers). Not every feature needs every segment.
- `desktop/` and `mobile/` — the two platform **composition shells**. They import feature
  components/hooks and arrange them; they are not themselves features.

**Imports** use the `@/` → `src/` alias for cross-directory references (configured in
`tsconfig.json`, `vite.config.ts`, `vite.ota.config.ts`); imports within the same
segment/folder stay relative. There are intentionally **no `index.ts` barrels** — deep
segment paths (`@/features/editor/components/note-editor`) keep each import's role explicit
and avoid an `editor`↔`notes` cycle (`notes-api` is used by editor/tree while `notes` uses
`editor-context`).

```
src/
  main.tsx, ota-bootstrap.ts   entry stubs (ota-bootstrap = index.html entry;
                               main.tsx = OTA bundle entry — vite.ota.config.ts)
  app/
    app.tsx, app-shell.tsx, main-app.tsx, error-boundary.tsx, launch-screen.ts, app.css
    hooks/      use-tree-interactions, use-note-opener  (app-shell orchestration glue)
    state/      selection-context, theme-context, appearance-api  (app-global stores)
  shared/
    ui/         shadcn primitives          lib/   dom, format, frontmatter, jobs,
    api/invoke  IPC logging wrapper                notes, selection, storage, utils (cn)
    hooks/use-mobile   types.ts   constants.ts
  features/<name>/   components/  hooks/  lib/  api/
    notes editor tree recording handwriting profiles sync security settings
  desktop/    desktop-shell, middle-pane, right-pane, app-sidebar
  mobile/     mobile-shell, tablet-layout, navigation, types, use-layout-mode,
              use-keyboard-insets, hooks/, ui/, views/, screens/
```

### Provider tree (`src/app/app.tsx`)

`app.tsx` is a thin composition layer. State lives in feature contexts (each provider is
imported from its feature's `hooks/`, or from `app/state/`):

```
ErrorBoundary                 — app-root crash guard
  ThemeProvider               — theme mode, notes list mode, editor font size   (app/state)
    SecurityProvider          — security state, unlock/lock/enable               (features/security)
      SecurityGate            — renders the lock screen when encrypted + locked
        ProfilesProvider      — profile list, active profile, per-profile sync   (features/profiles)
          GitSyncProvider     — git status, connect/pull/push, commit history    (features/sync)
            SelectionProvider — folder/note selection state, mobile helpers      (app/state)
              EditorProvider  — note editor state (wraps useNoteEditor)          (features/editor)
                NotesTreeProvider — folder tree, CRUD, rename                    (features/notes)
                  RecordingsProvider  — recording, transcription queue, playback (features/recording)
                    HandwritingProvider — image import, OCR queue                (features/handwriting)
                      AppShell  — UI rendering, DnD wiring, keyboard shortcuts
```

**Don't reorder these providers** without understanding the dependencies: NotesTree consumes
Selection + Editor; Editor consumes Selection + Profiles; most consume Profiles.

### app-shell.tsx (`src/app/app-shell.tsx`)

Orchestrates desktop behavior. Owns local UI state (`appMode`, `sidebarCollapsed`, pane
sizes, settings section). Renders `DesktopShell` (`src/desktop/`) or `MobileShell`
(`src/mobile/`) by viewport. Wires `useDragDrop()` + `useKeyboardNavigation()` (from
`features/tree/hooks`). The folder/note click + native context-menu handlers and the
programmatic open-folder/open-note navigation are factored out into `app/hooks/` (see
below), so the shell reads as composition rather than a pile of inline handlers.

### app/state (`src/app/state/`)

The cross-cutting stores that have no single domain home and are consumed everywhere:

- `theme-context.tsx` — theme + notesListMode (localStorage), `document` dark class, font
  size controls. `appearance-api.ts` is its native-theme IPC.
- `selection-context.tsx` — `selectedFolders`/`selectedNotes`/`activeFolder`/`activeNote`
  (+ setters) and the mobile selection helpers. Resets on profile / notes-root change.

(Features may import these from `@/app/state/...`; this is the one accepted upward edge.)

### app/hooks (`src/app/hooks/`)

Orchestration glue the shell delegates to — composition logic that wires several
contexts together but belongs to no single feature. It lives here (not in a feature)
because it depends on NotesTree, and `notes-tree-context` already depends on
`features/tree/lib`; routing it through the composition root keeps that edge one-way.

- `use-tree-interactions.ts` — folder/note click selection, expand/collapse toggle, and
  the native Tauri right-click menus. Reads Selection + NotesTree from context; takes only
  `foldersPanelRef` (for post-action focus). Consumed by the desktop + mobile shells.
- `use-note-opener.ts` — `openPinnedFolder` (sidebar Feed/Trash) and the `open-note`
  window-event handler that jumps to a recording's note from the Transcription page.

### features/

Each feature's context provider lives in `hooks/` alongside its hooks.

- **notes** — `components/note-row`; `hooks/notes-tree-context` (owns the folder tree,
  computed `treeData`/`flatItems`/`visibleItems`/`orderedIds`, rename state, and all CRUD:
  createNewNote / deleteNotes / deleteFolders / moveNotesToArchive / rename; consumes
  Selection + Editor to update them after CRUD), `hooks/use-note-previews`; `api/notes-api`
  (the IPC surface — `getTree`, `readNote`, `createNote`, `writeNote`, `getNoteMeta`,
  `deleteItems`, `moveItems`, `renameItem`, `setOrder`, …). `notes-api` is also used by
  editor and tree.
- **editor** — `components/note-editor` (Tiptap; shared desktop+mobile) and
  `components/lens/` (the multi-note "lens": `multi-note-lens` orchestrator + `lens-toolbar`
  + `lens-note-stage` + `note-readonly-content`); `hooks/{editor-context, use-note-editor,
  use-lens-annotations}`; `lib/{markdown-editor, note-annotations, lens-backmatter,
  lens-geometry}`. `use-note-editor`: debounced 400ms autosave, dirty/saving/error, empty-note
  cleanup, placeholder→slug rename. `use-lens-annotations`: all lens annotation state +
  per-note serialized persistence.
- **tree** — `components/{folders-panel, tree-node, tree-row, nav-note-row, recent-tree-node}`;
  `hooks/{use-drag-drop, use-keyboard-navigation}`; `lib/{tree-ops, dnd-tree,
  tree-dnd (DnD id/edge primitives), types}`. Tree components are
  presentational — data/handlers come from app-shell (which reads NotesTreeContext).
- **recording** — `components/recording-note-header`; `hooks/{recordings-context,
  use-audio-recorder}`; `api/recordings-api`. Dual-mode recorder (web MediaRecorder / native iOS).
- **handwriting** — `components/handwriting-note-header`; `hooks/handwriting-context`;
  `api/handwriting-api` (OpenAI / HuggingFace OCR queue).
- **profiles** — `hooks/profiles-context` (multi-profile; per-profile `notes_root` + sync
  settings in localStorage; `flushSaveRef` to flush the editor before switching);
  `api/profiles-api`. Heavily depended upon.
- **sync** — `components/local-sync-server-card`; `hooks/{git-sync-context, use-ssh-key
  (app-managed Ed25519 keypair lifecycle: load/generate/delete, shared by the desktop +
  mobile settings)}`; `api/{git-api (libgit2 IPC + SSH key lifecycle), local-sync-link}`.
- **security** — `components/lock-screen`; `hooks/security-context` (unlock/lock/enable,
  panic reset, auto-lock on background); `api/security-api`.
- **settings** — the aggregator UI. `components/desktop/` (settings-panel + 8 sections) and
  `components/mobile/` (settings-screen + 7 sections + helpers); `hooks/use-settings-data`
  (shared computed values); `lib/sections` (the `SettingsSectionId` registry + desktop and
  mobile section lists). Settings legitimately imports from many other features.

### Cross-context bridges (all in `src/app/app.tsx`)

1. **SecurityGate** — keeps the provider-heavy app unmounted while encrypted + locked.
2. **FlushSaveBridge** — writes EditorContext's `flushSave` into ProfilesProvider's
   `flushSaveRef` so profile switches flush unsaved edits.
3. **RecordingsProvider.onRecordingComplete** — refreshes the tree + selects the new note.
4. **GitSyncContext.gitPull({ onAfterPull })** — app-shell passes `refreshTree`.
5. **NotesTreeContext → Selection/Editor** — CRUD ops update selection + editor state.

### shared/

`shared/api/invoke.ts` — `invokeLogged` (dev-only sanitized IPC tracing) used by every
feature `api/`. `shared/lib/` — `dom`, `format` (formatters + `NotePreview` + `parseNotePreview`),
`frontmatter`, `jobs`, `notes`, `selection`, `storage`, `utils` (`cn`). `shared/ui/` — shadcn.
`shared/types.ts` — `FolderNode`, `NoteEntry`, `GitSyncStatus`, `ProfileSyncSettings`,
`ThemeMode`, `NotesListMode`, `SecurityState`, … `shared/hooks/use-mobile.ts` — shadcn breakpoint.

> **The one accepted `shared → feature` edge:** `shared/lib/format.ts`'s `parseNotePreview`
> imports `stripInlineAnnotationMetadata` from `features/editor/lib/note-annotations` to keep
> editor metadata out of previews. It is a single pure function and is commented in place;
> keep it the only such import.

### Desktop shell (`src/desktop/`)

- `desktop-shell.tsx` — 2-pane / 3-pane resizable layout.
- `middle-pane.tsx` — notes list (`SortableContext` + note-row) or settings sections.
- `right-pane.tsx` — editor (note-editor / multi-note-lens) or settings detail.
- `app-sidebar.tsx` — desktop left rail (feed / new / record / handwriting / settings / trash).

### Mobile shell (`src/mobile/`)

- `mobile-shell.tsx` — phone (nav bar + route renderer + drawer) or tablet layout, plus
  action-sheet / prompt / toast overlays. `tablet-layout.tsx` — tablet two-pane.
- `navigation.ts` — route types + `useReducer` state machine. `types.ts` — mobile constants/helpers.
- `hooks/` — `use-mobile-navigation`, `use-action-sheets`, `use-phone-nav-header`,
  `use-recent-buckets`, `use-edge-swipe`. `use-layout-mode.ts`, `use-keyboard-insets.ts`.
- `ui/` — primitives: `action-sheet`, `nav-bar`, `tab-bar`, `prompt-sheet`, `toast`.
- `views/` — reusable screen bodies used by phone screens + tablet: `folders-view`,
  `notes-view`, `editor-view`, `recent-view`, `recording-view`.
- `screens/` — one phone route screen per `route.kind` (`home/folders/notes/recent-date/
  recording/editor/settings-screen` + `index.tsx` route renderer).

### Layout modes

| Mode | Breakpoint | Shell | Notes panel |
|------|-----------|-------|-------------|
| phone | < 768px | MobileShell | Stack navigation |
| tablet | 768–1024px | MobileShell | Split view |
| desktop | > 1024px | DesktopShell | Resizable three-pane |

Detection in `src/mobile/use-layout-mode.ts`.

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
