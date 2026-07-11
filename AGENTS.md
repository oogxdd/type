# AGENTS.md

This document is for AI agents and developers who need to understand and modify this codebase.

## What this app is

A local-first markdown notes app. Notes are stored as `.md` files in a local folder tree ("working folders"), with optional Git sync across devices — including a one-button local-network server (an embedded SSH Git server with QR pairing) for syncing to a phone with no external host. Audio recording is supported, with per-folder transcription routing (local Whisper on desktop — self-provisioning, no manual install; AssemblyAI cloud; a pluggable native provider; or "leave pending for the desktop to transcribe after sync"). Handwriting OCR and voice transcription use independent queues with shared frontend queue plumbing. At-rest note-body encryption, the lock screen, panic-password local wipe, and the multi-note lens are optional frontend extension surfaces.

There are **two apps over one Rust core**: the desktop app is Tauri v2 + React (macOS/Windows/Linux), and the mobile app is React Native (Expo), talking to the same core through UniFFI bindings.

## Monorepo layout

npm workspaces (`apps/*`, `packages/*`) + one Cargo workspace at the repo root
(single `Cargo.lock` and `target/`).

```
apps/desktop/          The Tauri app: React frontend (src/) + Tauri shell (src-tauri/)
apps/mobile/           The React Native app (Expo). See apps/mobile/README.md
crates/type-core/      Framework-free Rust core: domain/application/ports/adapters
crates/type-ffi/       UniFFI bindings over type-core for non-Tauri shells
packages/shared/       @typenotes/shared — platform-free TS (domain types,
                       frontmatter, note previews, sync hints) used by both apps
packages/mobile-core/  @typenotes/mobile-core — typed TS bridge to type-ffi
                       (RawCore seam + in-memory mock; native module generated
                       on a Mac with uniffi-bindgen-react-native)
```

## Tech stack

- **Desktop frontend**: React 19, TypeScript, Vite, Tiptap (editor), DnD Kit (drag-and-drop), Tailwind + Shadcn/ui
- **Mobile app**: React Native (Expo), react-navigation, reanimated + gesture-handler, expo-audio, zustand
- **Rust core**: `crates/type-core`, organized as **domain / application / ports / adapters** (clean/hexagonal) across domains: notes, profiles, security, recordings (+ whisper_env), handwriting, import, git_sync, local_sync. The Tauri shell adds the `commands/` layer; `crates/type-ffi` adds the UniFFI layer.
- **Build**: root `npm run desktop:build` (tsc + vite). Rust: `cargo check --workspace`
- **Tests**: `npm test` (Vitest per workspace — pure logic; co-located `*.test.ts`) and `cargo test --workspace --lib` (Rust unit tests in `#[cfg(test)]` modules). CI (`.github/workflows/ci.yml`) runs both, plus workspace typechecks, on PRs and pushes to main.

## Rust core structure (crates/type-core/src/ + the Tauri shell)

The Rust core uses a pragmatic **domain / application / ports / adapters**
layout, framework-free so both shells (Tauri commands, UniFFI exports) drive
the same use cases. The shell-facing seam is `AppEnv { app_data_dir,
documents_dir }` — the only thing a shell must provide.
`apps/desktop/src-tauri/README.md` covers the shell; this is the navigation map
(paths below are inside `crates/type-core/src/`, except `commands/` which lives
in `apps/desktop/src-tauri/src/`).

```
crates/type-core/src/
  lib.rs               Crate root: declares the core layers, re-exports domain
                       note DTOs + adapter symbols, holds shared utilities, and
                       defines AppEnv (the shell seam).
  domain/<domain>.rs   Framework-free core DTOs/state. Notes has been moved here.
  application/<domain>.rs
                       Use-case services. Shells call these instead of owning
                       workflows directly.
  ports/<domain>.rs    Platform-agnostic contracts and gateway traits.
  adapters/<domain>.rs The real Rust implementation (filesystem, git2, crypto, …).
                       A large domain may instead be a folder module
                       (adapters/<domain>/mod.rs + submodules) — see recordings/,
                       notes/, profiles/, handwriting/, and git/.
  build.rs             Replicates Tauri's desktop/mobile cfg aliases from
                       CARGO_CFG_TARGET_OS so #[cfg(desktop)] works core-side.

apps/desktop/src-tauri/src/
  main.rs, lib.rs      Binary entry + app_env() (tauri::AppHandle → AppEnv),
                       macOS window alpha, pub fn run().
  commands/<domain>.rs Thin #[tauri::command] wrappers that lock-gate requests,
                       construct core application services, and dispatch
                       blocking work.

crates/type-ffi/src/   #[uniffi::export] functions per domain over the same
                       services (JSON-string args/results matching the Tauri
                       IPC shapes), CoreError, init_core(), and the foreign
                       TranscriptionProvider trait for host-side transcription.
```

**Layer wiring.** Shells (commands / FFI exports) import application services
plus concrete core adapters explicitly. Application services depend on port
traits/gateways. Adapters own filesystem roots, git2, crypto, HTTP/native APIs,
and process-global workers; they receive `AppEnv` instead of a Tauri handle.
The `generate_handler![]` macro in `commands/mod.rs` uses qualified paths
(`notes::read_note`, `git_sync::git_pull`, …) to disambiguate command modules.

### type-core lib.rs — shared hub

- Layer declarations: `pub mod domain;`, `pub mod ports;`, `pub mod application;`, `pub mod adapters;`
- `AppEnv { app_data_dir, documents_dir }` — what a shell provides instead of a `tauri::AppHandle`
- Shared crate re-exports: note domain DTOs, adapter symbols, `BASE64`, `fs`, `HashMap`, `HashSet`, `PathBuf`
- Shared constants: `RECORDING_STATUS_PENDING/QUEUED/PROCESSING/COMPLETED/FAILED`
- Shared utilities: `app_data_dir`, `now_ms`, `time_to_ms`, `note_parent_folder_path`, `decode_base64_payload` (+ audio/image variants), `response_error`

### commands/ — Tauri IPC layer (apps/desktop/src-tauri)

`commands/mod.rs` holds `run()` (builds the Tauri app, registers plugins, calls
`generate_handler![]`) and the shared `run_blocking_command` helper. One file per
domain, each a set of thin wrappers around application services:

| File | Commands |
|------|----------|
| `security.rs`   | state, enable, lock, unlock, set preferences |
| `profiles.rs`   | profile CRUD, backup zip, export to Documents |
| `notes.rs`      | tree, read/create/write, meta, bulk list previews, move/delete/rename, order, timestamp |
| `recordings.rs` | save, queue (AssemblyAI + local Whisper), retrigger, Whisper status, list, read audio |
| `handwriting.rs`| save attachment, queue OCR, list OCR jobs |
| `import.rs`     | scan Apple Notes folder, start import, poll import status |
| `git_sync.rs`   | SSH key gen/get/delete, status, history, connect, pull, push |
| `local_sync.rs` | local server status/start/stop, discover peers |

### application/ — use-case boundary

Each `application/<domain>.rs` exposes a small service struct. Notes contains the
real note workflows (tree, read/write, create, move/delete/rename/order) and
talks only to ports for storage, document parsing, encryption, history, IDs, and
time. Other domains expose use-case facades over gateway traits so commands no
longer own workflows; their deeper persistence/worker logic remains in adapters.

### adapters/ — implementations

Key symbols live in `adapters/<domain>.rs`:

- **notes** — a folder module (`notes/mod.rs` + `front_matter.rs` + `naming.rs` + `tree.rs`) for filesystem notes, front-matter, tree, ordering. `mod.rs` is the hub: shared constants (`ORDER_FILE`, `FEED_FOLDER`, `ARCHIEVE_FOLDER`, `RECORDINGS_STORAGE_FOLDER`, `ATTACHMENTS_STORAGE_FOLDER`, `PROTECTED_SYSTEM_FOLDERS`) + root/path resolution (`ensured_notes_root` resolves the active profile's root, `resolve_path`, `strip_root`) + concrete port adapters (`FilesystemNotesRepository`, `FrontMatterNoteDocumentCodec`, `RuntimeNoteBodyCrypto`, `UuidNoteIdGenerator`, `SystemNoteClock`). Note DTOs live in `domain/notes.rs`. `front_matter.rs`: `parse/render/write_note_with_front_matter`. `naming.rs`: `allocate_note_file_name` (UTC-slug / uuid_v7 / uuid_v7_prefix_slug) + Unicode-aware `slug_from_content`. `tree.rs`: `build_folder_node`, `ensure_system_folders`, `migrate_legacy_system_folders`, order helpers, `collect_markdown_note_files`.
- **profiles** — a folder module (`profiles/mod.rs` + `state.rs` + `settings.rs` + `backup.rs`) for multi-profile ("working folder") support. `settings.rs`: per-folder `.type/settings.json` (`ProfileSettings` — legacy mobile auto flags and the optional `transcription_mode` with `effective_transcription_mode()` fallback; this file is tracked and syncs with the notes), the per-folder **device-local** `.type/device.json` (the git connection: remote/branch/credentials/pinned host key — split out by `save_profile_settings`, merged back by `load_profile_settings`, excluded from sync via `.git/info/exclude`), plus the device-local `config.json` (`AppConfig` — API keys etc., never synced). `update_settings` preserves a persisted `transcription_mode` (and the pinned host key) when a writer omits them. `mod.rs`: `.notes-profiles.json` constants + DTO types + `profiles_file_path`/`profile_root_for_id`. `state.rs`: filesystem discovery, normalization, persistence, legacy `.notes-sessions.json` migration, and the `ensure_profiles_state`/`find_profile`/`*_state` CRUD (+ `normalize_notes_root_path`, dir copy/move helpers). `backup.rs`: profile backup zip + Documents export.
- **security** — XChaCha20-Poly1305 at-rest body encryption with an Argon2id-derived key. `SECURITY_RUNTIME` (OnceLock<Mutex>) holds the in-memory key after unlock. `.notes-security.json` config. `encrypt_note_body_for_write`, `decrypt_note_body_for_read`, `ensure_security_unlocked_for_app` (the lock gate most commands call), panic flow `panic_reset_local_data`.
- **recordings** — a folder module (`recordings/mod.rs` + `whisper.rs` + `assembly.rs`): save audio → note with metadata. `mod.rs` owns the transcription queue worker (which dispatches on `TranscriptionMethod`), types, queue state, note scanning, and file naming. Backends: `whisper.rs` (desktop, managed-Python `faster-whisper` via `whisper_env`; `check_whisper_availability`, `transcribe_audio_local_whisper`), `assembly.rs` (AssemblyAI cloud, used on mobile), and `TranscriptionMethod::Provider` — a shell-registered `ports::recordings::TranscriptionProvider` (how the mobile FFI plugs native speech recognition into the same queue). `queue_recordings_with_method` is the shared scan-and-enqueue; `collect_recording_notes`, queue snapshot for the UI.
- **whisper_env** — desktop only. Provisions and owns an isolated CPython + faster-whisper under app-data using [`uv`](https://docs.astral.sh/uv/) (downloading `uv` itself on first use if absent), so the user installs nothing. `whisper_env_ready`, `managed_python`, `ensure_whisper_env`.
- **handwriting** — a folder module (`handwriting/mod.rs` + `openai.rs` + `huggingface.rs`): save image attachment → note; `HANDWRITING_OCR_QUEUE` worker. `mod.rs` owns attachment saving, the queue + worker, note scanning, and provider dispatch; each provider's HTTP transcription lives in its own submodule — `openai.rs` (`HandwritingOcrProvider::OpenAi`, GPT-4o) and `huggingface.rs` (`::HuggingFace`, 503 retry). `collect_handwriting_notes`.
- **import** — Apple Notes folder importer. Walks an *exported* Apple Notes tree (Markdown/HTML/plain-text — Apple Notes has no native bulk export), creating notes in the active root. Auto-detects note files, converts HTML→Markdown best-effort, strips foreign front-matter, and preserves the original creation date (front-matter `created`/`created_ms`/… → epoch ms / RFC 3339 / date-only, else filesystem time). `preserve` mirrors the source hierarchy under one target folder; `flatten` drops everything into `Feed`. Runs on a worker thread writing to a process-global progress snapshot the UI polls (no Tauri events); `scan_apple_import_source`, `run_apple_notes_import`, `apple_import_snapshot`. Notes are written via `write_note_with_front_matter`, so encryption is transparent (import requires unlock).
- **git** (the `git_sync` domain) — libgit2 sync. `ensure_git_repo`/`open_repo`, `perform_fetch`/`fast_forward_to`/`merge_fetched_commit`/`commit_all_changes`, `resolve_target_branch`/`switch_or_prepare_branch`. Conflicts keep "ours" and write "theirs" as `.conflict.md` siblings — merge never blocks. `build_git_status`, `build_git_history`. `build_callbacks` auth order: app SSH key file → SSH agent → username/password. Ed25519 keypair under `<app_data_dir>/ssh/`. Bootstrap-artifact detection for first sync.
- **local_sync** — desktop hosts an **embedded SSH Git server** (russh; `ssh_server.rs` + `devices.rs`) so a phone on the same Wi-Fi / hotspot can push/pull with no external host, encrypted and key-authenticated. Pairing rides the QR: the `ssh://pair-<token>@ip:9418/<folder>` URL carries a per-run token in the username; an unknown key authenticating with it gets registered in the authorized-devices store (host key + devices under `<app_data_dir>/local_sync/`). Starting never commits — pending desktop edits are committed just before each serve. mDNS advertises a token-less URL (`_typenotes-sync._tcp`). State lives in a process-global `Mutex<Option<RunningDaemon>>`, killed on app exit. `receive.denyCurrentBranch=updateInstead` lets phone pushes update the live working tree. See `docs/LOCAL_SYNC.md`.

### ports/ — contracts

Each `ports/<domain>.rs` is documentation-first and now also carries
application-facing gateway traits. Public traits document the user-facing
contracts; `pub(crate)` gateway traits are what application services depend on.
Keep these in sync with adapter behavior when a contract changes.

### Cross-domain dependencies & visibility

```
lib.rs (shared utils) ← everything
profiles       ← security (panic reset, enable migration)
profiles       ← notes    (notes_root resolution)
notes          ← security (encrypt_note_body_for_write)
notes          ← recordings / handwriting (front matter, file naming, collection)
import         ← notes (root resolution, note creation/naming) + security (unlock gate)
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

## How the desktop frontend is structured

All paths in this section are inside **`apps/desktop/src/`**. Platform-free
helpers (domain types, frontmatter, note-preview parsing/format, annotation
metadata, jobs, pure tree walkers, system-folder constants) live in
**`packages/shared`** (`@typenotes/shared/<module>`) so the mobile app shares
them; this app keeps only browser-bound code.

The layout is a conventional separation of concerns, with components nested
by domain:

```
src/
  main.tsx      entry stub (index.html entry -> mountApp)
  app/          composition root: app.tsx (gates around the shell),
                bootstrap.ts (starts the state layer - see below),
                readiness.tsx (AppSecurityGate / AppReadinessGate),
                main-app.tsx (mountApp), error-boundary, launch-screen, app.css
  components/   React components, nested by domain:
    shell/          app-shell (command palette + workspace wiring),
                    workspace-shell (panes, DnD, keyboard shortcuts),
                    pane-layout (2/3-pane resizable), app-sidebar,
                    middle-pane, right-pane, context-menu
    navigation/     folders-panel, feed-panel, tree-node/tree-row/nav-note-row
                    (+ tree.css)
    editor/         note-editor (Tiptap)
    notes-list/     note-row (middle-pane list row)
    settings/       settings-panel + one file per section + settings-ui
    command-palette/ lens/ recording/ handwriting/ security/ sync/
    ui/             shadcn primitives
  state/        the entire state layer: one zustand store per domain plus
                plain-function actions (see below) - appearance, selection,
                profiles, security, editor, notes (notes-store +
                notes-actions + note-previews), recordings, handwriting,
                git-sync
  hooks/        React hooks that wire stores/DnD/keyboard/panes into
                components (use-drag-drop, use-keyboard-navigation,
                use-tree-interactions, use-editor-pane, use-navigation-tabs,
                use-command-palette-commands, use-apple-import, ...)
  lib/          pure helpers: dom, storage, memoize, browser (base64 +
                yieldToUi), selection modifiers, constants, extensions
                (the extension registry), folder-search, note-autoname,
                markdown-editor, profile-sync-settings, settings-sections;
                lib/notes/ (tree + feed + navigation models, all tested) and
                lib/lens/ (annotation models)
  api/          invoke.ts (dev-logged IPC wrapper) + one <domain>-api.ts per
                backend command group
```

**Imports** use the `@/` -> `src/` alias for cross-directory references;
imports within the same directory stay relative. There are intentionally
**no `index.ts` barrels**.

### The state layer (`src/state/`)

There are **no React context providers**. Each domain is a module-level
zustand store holding raw state, plus exported **plain async functions** as
actions - callable from components, other stores, timers, and Tauri event
handlers alike, with no hook ceremony. Components subscribe with narrow
selectors (`useNotesStore((s) => s.tree)`), so unrelated changes do not
re-render them.

Derived data (flattened tree, visible rows, feed buckets, per-folder
previews, sync settings, ...) is computed by `memoizeOne`-wrapped pure
functions (`lib/memoize.ts`) - the module-level equivalent of a shared
`useMemo`. React selectors and non-React callers share one cached
computation per distinct input identity; the pure models themselves live in
`lib/notes/`.

Cross-domain reactions are store subscriptions, wired once in
`app/bootstrap.ts` (called from `mountApp()` before React renders):

- **Profile/root switch** -> clear editor, reset selection, reload tree, and
  swap the preview cache for the new profile's persisted snapshot.
  Registration order matters: `initEditor()` runs before the selection-reset
  subscription so the flush triggered by that reset sees an already-cleared
  editor and cannot write stale content into the new root.
- **Security** -> data domains (re)load on every locked->unlocked transition,
  because the backend rejects content commands while locked. With the
  security extension off, data loads immediately; the security-state fetch
  still happens because the preview-persistence invariant depends on it.
- **Editor** -> `selection.activeNote` changes drive the flush-previous /
  load-next workflow (save dirty notes, delete emptied ones, auto-rename by
  content slug); `visibilitychange`/`beforeunload` flush pending saves; the
  profiles store calls the registered editor flush before any profile
  mutation swaps the notes root.
- **Recordings / handwriting** auto-queue loops tick every 15s and self-gate
  on lock state, profile readiness, and (for OCR) a configured provider key.

Invalidation is direct function calls, not events: `refreshTree()`
(state/notes-store.ts) and `invalidateNotePreviews()`
(state/note-previews.ts) replaced the old CustomEvent bus. The preview cache
keeps the stale-while-revalidate design documented in
`docs/architecture/07-frontend-caching.md`: module-level Map for object
identity, per-profile localStorage snapshot for instant first paint,
persistence disabled while encryption is on.


## Mobile app (apps/mobile) + FFI bridge

The React Native app (Expo) reuses the Rust core through
`crates/type-ffi` → `packages/mobile-core` → screens/stores:

- **`crates/type-ffi`** — `#[uniffi::export(async_runtime = "tokio")]`
  functions per domain, JSON-string args/results matching the Tauri IPC
  shapes, so one set of TS wire types (`@typenotes/shared/types`) fits both
  shells. `init_core(app_data_dir, documents_dir)` must run first.
  `TranscriptionProvider` is a foreign trait (`with_foreign`): Swift/Kotlin/JS
  implementations run inside the core's queue worker.
- **`packages/mobile-core`** — `raw-core.ts` (the `RawCore` interface + a
  `setRawCore()` seam), `core-api.ts` (typed facade the app imports), and
  `mock-core.ts` (in-memory RawCore for vitest and "demo mode"). The real
  turbo module is generated on a Mac with `uniffi-bindgen-react-native`
  (ubrn 0.31.x = uniffi 0.31); output dirs are gitignored. Regenerate after
  any `type-ffi` change and keep `raw-core.ts` in sync.
- **`apps/mobile`** — the signature interaction: the app opens on a blank
  page (type immediately); swipe up files the page into Feed and a fresh
  blank page appears. `src/lib/capture.ts` (pure, tested) owns that note
  lifecycle with the same rules as the desktop editor (lazy create,
  debounced writes, flush on leave, empty-note cleanup). Navigation is one
  native stack whose root is the menu screen (feed/folders tabs + sync/
  settings); Capture boots pushed on top of it, so the left-edge swipe-back
  reveals the menu and a leftward swipe on the menu pushes a fresh capture
  page. Voice capture is a floating dictation button on the capture page —
  tap to start/stop or hold to record while pressed (expo-audio →
  `save_audio_recording` → queue per `transcription_mode`). Other screens:
  feed, folder browser, plain-text editor, sync (status/connect/pull/push/SSH
  key/history), settings (working folders, notes-root move, transcription
  mode, AssemblyAI key). Zustand stores in `src/state/`. Without the native
  module the app boots the mock core in demo mode (bottom banner) — that is
  what CI and Expo Go exercise.

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
- **Per-folder transcription mode**: `.type/settings.json` inside a notes root carries `transcription_mode` (`off` / `desktop` / `assemblyai` / `native`). Absent = fall back to the legacy `mobile_auto_transcription_enabled` flag (true → assemblyai, false → desktop) — use `effective_transcription_mode()` / `effectiveTranscriptionMode()` instead of reading the field. Settings writers that omit the field must not clear a persisted mode (the core's `update_settings` merge handles this).
- **Two shells, one core**: new backend features go in `crates/type-core`, then get exposed twice — a `#[tauri::command]` in `apps/desktop/src-tauri/src/commands/` and a `#[uniffi::export]` in `crates/type-ffi`. After changing `type-ffi`, regenerate the mobile native module (Mac, ubrn) and keep `packages/mobile-core/src/raw-core.ts` in sync. Step-by-step checklist (and what the ubrn codegen actually does): `docs/architecture/09-adding-features-and-codegen.md`.
- **Git sync uses libgit2**, not shell git. The Rust backend handles all git operations.
- **Git server support**: `ssh://` and `https://` remotes are supported (plus SCP-like `git@host:path`). LAN `git://` remotes are rejected with a re-pair hint — they are leftovers from the pre-SSH local sync. SSH host keys: pinned fingerprint (from QR pairing) is verified; unpinned local-network hosts are trusted on first use; internet hosts keep default known-hosts behavior. See `docs/ssh-sync-setup.md` for SSH sync setup with key-based auth.
- **SSH key auth**: The app can generate and store an Ed25519 keypair in `<app_data_dir>/ssh/`. When an SSH key exists, all git operations (connect/push/pull) use it automatically before falling back to SSH agent or username/password.
- **Merge conflict resolution**: Conflicts during pull are resolved by keeping the local version and saving the remote version as a `.conflict.md` sibling file (e.g., `note.md` + `note.conflict.md`). The merge always completes — sync is never blocked by conflicts. Users resolve manually and delete the `.conflict.md` file when done.
- **Lock guard is backend-enforced**: most app commands return a locked error while encrypted mode is locked; only security commands remain callable.
- **Security UI is optional**: the frontend shell hides the lock screen and security settings unless the extension registry enables them.
- **Encryption scope is note body only**: recordings/attachments are currently stored unencrypted.
- **Annotation cleanup is shared**: `@typenotes/shared/annotation-metadata` owns the lens/inline annotation stripping used by previews, slugging, and the editor.
- **Sync history UX**: settings now show commit history from real git log. This cannot reliably encode which device performed push/pull for every commit.
- **Note previews are persisted per profile** in localStorage (`notes-viewer-note-previews-v1:<profileId>`) and hydrated on launch for an instant first paint, then revalidated via the bulk `list_note_previews` command (stale-while-revalidate). Persistence is disabled while encryption is on, and enabling encryption purges the snapshots (`clearPersistedNotePreviews` in `src/lib/storage.ts`). `get_tree` never reads note bodies — Feed is name-sorted (file names are time-prefixed) and the UI re-sorts by front-matter timestamps from previews. The full cache/invalidation design (and the deferred TanStack Query decision) is documented in `docs/architecture/07-frontend-caching.md`.
- **Editor saves are debounced** (400ms). `flushSave()` (state/editor-store.ts) must be called before anything that swaps the notes root or hides the app; selection changes, profile mutations, and `beforeunload`/`visibilitychange` already do.
- **`shouldNestNotesInNavigation`**: When `notesListMode === "nested"`, notes appear inline inside the folder tree instead of in a separate middle pane. This affects keyboard navigation, rendering, and the visible navigation items computation.
- **Bootstrap subscription order matters**: in `app/bootstrap.ts`, `initEditor()` must register its profile-switch subscription before the selection-reset subscription — otherwise the selection reset triggers an editor flush of the previous profile's note against the new root. See the state-layer section above.
