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
- **ocr_env** — desktop-local EasyOCR provisioning in its own managed Python environment. Model weights default under app data, but `AppConfig.local_ocr_model_path` may point to an absolute external-volume folder.
- **handwriting** — a folder module (`handwriting/mod.rs` + `local.rs` + `openai.rs` + `huggingface.rs`): save image attachment → pending note; `HANDWRITING_OCR_QUEUE` worker. Mobile only saves; desktop scans after sync and dispatches through `HandwritingOcrMethod`. `local.rs` runs EasyOCR in the managed `ocr_env` with configurable model storage, while `openai.rs` (Responses vision) and `huggingface.rs` (Inference API, 503 retry) are cloud options. `collect_handwriting_notes`.
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

All paths in this section are inside **`apps/desktop/`**. Platform-free
helpers that used to live in `src/shared` (domain types, frontmatter,
note-preview parsing/format, annotation metadata, jobs, pure tree walkers,
system-folder constants) have moved to **`packages/shared`**
(`@typenotes/shared/<module>`) so the mobile app shares them; `src/shared`
keeps only browser-bound pieces (dom, storage/localStorage, base64 +
yieldToUi, selection modifiers, shadcn `ui/`, the `invoke` wrapper, and
desktop-only constants).

The frontend is **feature-sliced**. There are four kinds of place code can live:

- `app/` — the composition root (providers, gates, the orchestrating shell), the
  app-global stores that belong to no single domain (`app/state/`), and the
  orchestration hooks the shell delegates to (`app/hooks/`).
- `shared/` — domain-agnostic building blocks usable by anything: `ui/` (shadcn
  primitives), `lib/` (pure helpers), `api/` (the `invoke` IPC wrapper), `hooks/`,
  `types.ts`, `constants.ts`. **`shared/` is a leaf** — it must not import from `features/`.
- `features/<name>/` — one folder per user-facing domain. Each owns its code in
  **segments**: `components/` (`.tsx`), `hooks/` (React hooks *and* context providers),
  `lib/` (pure helpers), `api/` (Tauri IPC wrappers). Not every feature needs every segment.
- `desktop/` — the desktop **composition shell**. It imports feature components/hooks
  and arranges them; it is not itself a feature. (The old in-repo `mobile/` shell is
  gone — mobile is now the separate React Native app in `apps/mobile`.)

**Imports** use the `@/` → `src/` alias for cross-directory references (configured in
`tsconfig.json` and `vite.config.ts`); imports within the same segment/folder stay
relative. There are intentionally **no `index.ts` barrels** — deep segment paths
(`@/features/notes/editor/components/note-editor`) keep each import's role explicit.

```
src/
  main.tsx    entry stub (index.html entry → mountApp)
  app/
    app.tsx, app-shell.tsx, providers.tsx, readiness.tsx, main-app.tsx,
    error-boundary.tsx, launch-screen.ts, app.css
    hooks/      use-tree-interactions, use-note-opener  (app-shell orchestration glue)
    lifecycle/  use-background-save
    state/      selection-store, appearance-store (app-global state)
  shared/
    ui/         shadcn primitives          lib/   dom, notes, selection, storage,
    api/invoke  IPC logging wrapper                utils (cn)
    hooks/use-mobile   constants.ts
  features/
    notes/      api/notes-api + editor/ (Tiptap, autosave) + list/ (previews)
                + navigation/ (tree state/actions/model/ui)
    lens/       multi-note lens (extension-gated)
    recording handwriting processing import profiles sync
    security settings command-palette extensions
  desktop/    desktop-shell, desktop-app-shell, middle-pane, right-pane,
              app-sidebar, desktop-context-menu, hooks/
```

### Provider tree (`src/app/providers.tsx`)

`app.tsx` renders `ErrorBoundary > AppProviders > AppShell`; `providers.tsx` is the
composition layer. State lives in feature contexts:

```
AppearanceProvider            — persists appearance store + document theme      (app/state)
  SecurityProvider            — security state; UI is extension-gated           (features/security)
    AppSecurityGate           — renders lock screen only when extension enabled (app/readiness)
      ProfilesProvider        — profile list, active profile, per-profile sync  (features/profiles)
        GitSyncProvider       — git status, connect/pull/push, commit history   (features/sync)
          SelectionProvider   — resets selection store on profile changes       (app/state)
            EditorProvider    — note editor state (wraps useNoteEditor)         (features/notes/editor)
              NotesTreeProvider — folder tree, CRUD, rename                     (features/notes/navigation)
                AppReadinessGate — hides the launch splash once data is ready   (app/readiness)
                  RecordingsProvider  — recording, transcription queue, playback (features/recording)
                    HandwritingProvider — image import, OCR queue                (features/handwriting)
                      AppShell  — UI rendering, DnD wiring, keyboard shortcuts
```

**Don't reorder these providers** without understanding the dependencies: NotesTree consumes
Selection + Editor; Editor consumes Selection + Profiles; most consume Profiles.

### app-shell.tsx (`src/app/app-shell.tsx`)

The composition boundary. It owns command-palette/file-picker coordination and renders
`DesktopAppShell`; desktop state and behavior (pane sizes, DnD, keyboard navigation,
pane refs) live in `src/desktop/desktop-app-shell.tsx`. Shared folder/note interaction
and programmatic navigation live in `app/hooks/`.

### app/state (`src/app/state/`)

The cross-cutting stores that have no single domain home and are consumed everywhere:

- `appearance-store.tsx` — Zustand store for theme, notes-list mode, and editor font
  size. Consumers use selectors; `AppearanceProvider` owns localStorage and
  document-theme synchronization.
- `selection-store.tsx` — Zustand store for folder/note selection. Consumers use
  selectors so unrelated selection changes do not re-render them.
  `SelectionProvider` only resets the store on profile/root changes.

(Features may import these from `@/app/state/...`; this is the one accepted upward edge.)

### app/hooks (`src/app/hooks/`)

Orchestration glue the shell delegates to — composition logic that wires several
contexts together but belongs to no single feature. It lives here (not in a feature)
because it depends on NotesTree, and `notes-tree-context` already depends on
`features/tree/lib`; routing it through the composition root keeps that edge one-way.

- `use-tree-interactions.ts` — folder/note click selection, expand/collapse toggle, and
  the right-click context-menu state (rendered by `desktop/desktop-context-menu`). Reads
  Selection + NotesTree from context; takes only `foldersPanelRef` (for post-action focus).
- `use-note-opener.ts` — `openPinnedFolder` (sidebar Feed/Trash) and the `open-note`
  window-event handler that jumps to a recording's note from the Transcription page.

### features/

Each feature's context provider lives in `hooks/` alongside its hooks.

- **notes** — the note domain, split into sub-slices:
  - `api/notes-api` — the IPC surface (`getTree`, `readNote`, `createNote`, `writeNote`,
    `getNoteMeta`, `listNotePreviews`, `deleteItems`, `moveItems`, `renameItem`, `setOrder`, …),
    used by every other notes sub-slice.
  - `editor/` — `components/note-editor` (Tiptap); `hooks/{editor-context, use-note-editor}`;
    `lib/{markdown-editor, note-autoname}`. `use-note-editor`: debounced 400ms autosave,
    dirty/saving/error, empty-note cleanup, and the flush/rename bridge into the notes domain.
  - `list/` — note list components + `hooks/use-note-previews` (stale-while-revalidate
    preview cache).
  - `navigation/` — `state/{notes-tree-context, use-notes-tree-state, use-notes-tree-actions}`
    (tree loading/derived data/rename state; create/delete/move/flatten/rename/info workflows
    that consume Selection + Editor setters), `model/{notes-tree-model, feed-tree-model,
    tree-ops, dnd-tree, tree-dnd, types}`, `ui/` (folders panel, tree rows, feed panel),
    `hooks/` (drag-drop, keyboard navigation).
- **lens** — the multi-note "lens" extension surface: `components/{multi-note-lens,
  lens-toolbar, lens-note-stage, note-readonly-content}`; `hooks/use-lens-annotations`;
  `lib/{note-annotations, lens-geometry}`. Extension-gated and lazy-loaded.
- **processing** — shared queue helpers for the background job domains:
  `hooks/{use-processing-queue, use-auto-queue-loop}`. Recording transcription and handwriting
  OCR each keep their own queue/workers, but both use this shared plumbing for snapshot refresh,
  preview invalidation, and timer behavior.
- **recording** — `components/recording-note-header`; `hooks/{recordings-context,
  use-audio-recorder}`; `api/recordings-api`. Web `MediaRecorder` capture; transcription
  always auto-queues to local Whisper. Queue bookkeeping uses the shared `processing`
  hooks above.
- **handwriting** — `components/handwriting-note-header`; `hooks/handwriting-context`;
  `api/handwriting-api` (OpenAI / HuggingFace OCR queue). OCR queue bookkeeping uses the
  shared `processing` hooks above.
- **import** — Apple Notes importer. `api/import-api` (scan/start/status IPC + folder picker);
  `hooks/use-apple-import` (pick → scan → import state machine that polls `apple_import_status`).
  Its UI is the desktop settings "Import" section. Desktop-only (needs a folder picker).
- **profiles** — `hooks/profiles-context` (thin provider), `hooks/use-profile-actions`
  (profile CRUD + settings writes with editor flush), `hooks/use-legacy-profile-sync-migration`
  (one-time localStorage -> backend migration); per-profile `notes_root` + sync settings are
  stored by the backend. `lib/profile-sync-settings` maps app-wide vs profile-local sync
  settings; `flushSaveRef` flushes the editor before switching;
  `api/profiles-api`. Heavily depended upon.
- **sync** — `components/local-sync-server-card`; `hooks/{git-sync-context,
  use-git-sync-workflows, use-ssh-key (app-managed Ed25519 keypair lifecycle:
  load/generate/delete)}`; `api/git-api` (libgit2 IPC + SSH key lifecycle).
  The `type2://sync` QR-code link format lives in `@typenotes/shared/sync-link`
  (desktop builds it, the phone scans/parses it).
- **security** — `components/lock-screen`; `hooks/security-context` (unlock/lock/enable,
  panic reset, auto-lock on background); `api/security-api`. The shell now treats this as an
  extension surface, so the UI should be hidden unless the extension registry opts it back in.
- **settings** — the aggregator UI. `components/desktop/` (settings-panel + sections,
  incl. "Import" and "Updates"); `hooks/use-settings-data` (shared computed values);
  `lib/sections` (the `SettingsSectionId` registry). Settings legitimately imports from
  many other features.
- **extensions** — typed frontend feature registry for optional surfaces. `registry.ts`
  controls whether multi-lens, security, and other extension-only UI is surfaced.
- **command-palette** — `components/command-palette` (renderer) +
  `hooks/use-command-palette-commands` (⌘K / Ctrl+K listener, command construction,
  terminal `mv` move-mode state) + `lib/folder-search` (pure `mv` path parsing + folder
  autocomplete). It reads live Selection + NotesTree + Theme from context, builds
  context-aware commands (selected notes/folders) plus always-on create/navigate/theme
  commands, and receives cross-shell navigation callbacks from app-shell. Typing `mv `
  (or running "Move note to folder…") switches the input into a shell-style folder picker:
  `mv pe` fuzzy-matches every folder by name, `mv personal/` drills into children, Tab
  completes the highlighted folder, Enter moves the active/selected notes (creating missing
  folders).

### Cross-context bridges (all in `src/app/providers.tsx`)

1. **AppSecurityGate** — keeps the provider-heavy app unmounted while encrypted + locked.
2. **FlushSaveBridge** — writes EditorContext's `flushSave` into ProfilesProvider's
   `flushSaveRef` so profile switches flush unsaved edits.
3. **RecordingsProvider.onRecordingComplete** — refreshes the tree + selects the new note.
4. **GitSyncContext.gitPull({ onAfterPull })** — app-shell passes `refreshTree`.
5. **NotesTreeContext → Selection/Editor** — CRUD ops update selection + editor state.

### shared/

`shared/api/invoke.ts` — `invokeLogged` (dev-only sanitized IPC tracing) used by every
feature `api/`. `shared/lib/` — `dom`, `notes` (base64 + yieldToUi), `selection`,
`storage`, `utils` (`cn`). `shared/ui/` — shadcn. `shared/hooks/use-mobile.ts` — the
shadcn breakpoint hook (used by the sidebar primitive; not a mobile shell).
Domain types (`FolderNode`, `NoteEntry`, `GitSyncStatus`, `ProfileSyncSettings`, …),
`format`, `frontmatter`, and `jobs` live in `@typenotes/shared`.

### Desktop shell (`src/desktop/`)

- `desktop-app-shell.tsx` — desktop interaction state (pane refs, DnD wiring, keyboard
  navigation, context menus) around the layout.
- `desktop-shell.tsx` — 2-pane / 3-pane resizable layout.
- `middle-pane.tsx` — notes list (`SortableContext` + note-row) or settings sections.
- `right-pane.tsx` — editor or settings detail; `hooks/use-desktop-editor-pane` owns
  editor/lens mode state, and the multi-note lens is lazy-loaded behind the extension gate.
- `hooks/use-desktop-navigation` — Feed/Folders tab state and desktop middle-pane note list
  selection/context-menu behavior.
- `app-sidebar.tsx` — desktop left rail (feed / new / record / handwriting / settings / trash).

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
  page (type immediately); swipe up slides the page off the top (a fresh
  blank page rides in from below, finger-driven) and files it into Feed.
  `src/lib/capture.ts` (pure, tested) owns that note lifecycle with the same
  rules as the desktop editor (lazy create, debounced writes, flush on
  leave, empty-note cleanup). Mobile navigation uses one native stack with
  Menu at its root and Capture initially pushed above it. Native back reveals
  Menu; Menu → Capture and Capture → Sync use finger-driven preview overlays
  followed by no-animation stack pushes, preserving the pre-pager interaction
  model. Leaving Capture flushes its draft; returning from Menu opens a fresh
  capture screen. Feed/Folder/Editor/Sync/Settings are ordinary pushed screens.
  Voice capture is a floating dictation button on the capture page, shown
  only while the page is blank — tap to start/stop or hold to record while
  pressed (expo-audio → `save_audio_recording` → queue per
  `transcription_mode`). Recording holds a background audio session
  (`shouldPlayInBackground`) so it survives the screen sleeping, and its timer
  runs off a wall-clock anchor rather than the recorder's polled
  `durationMillis`, which freezes while the app is suspended. That same anchor
  drives an iOS Live Activity (Lock Screen + Dynamic Island, with an
  interactive Stop) from the local `modules/recording-activity` Expo module —
  see its README, including which parts still need a Mac to verify.
  Long-press reveals camera/gallery handwriting-photo
  actions; `save_handwriting_attachment` leaves OCR pending for desktop. Other screens:
  feed, folder browser, plain-text editor, sync (status/connect/pull/push/SSH
  key/history), settings (working folders, notes-root move, transcription
  mode, AssemblyAI key, appearance). Zustand stores in `src/state/`. Without the native
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
- **Mobile appearance is device-local and derived**: the phone's background / text color / editor text size live in `appearance.json` beside the core's app data — *not* in `ProfileSettings`, so they never reach a notes root and never sync. `apps/mobile/src/theme.ts` is no longer two fixed palettes: `lib/appearance.ts` derives surface/border/secondary text from the chosen background and picks the dark variant from its luminance. Don't remove `readableOn`'s WCAG-AA floor on body text — an unreadable combination would lock the user out of the settings screen that fixes it. Text size intentionally applies only to the capture page and the note editor, not to lists or chrome.
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
- **Note previews are persisted per profile** in localStorage (`notes-viewer-note-previews-v1:<profileId>`) and hydrated on launch for an instant first paint, then revalidated via the bulk `list_note_previews` command (stale-while-revalidate). Persistence is disabled while encryption is on, and enabling encryption purges the snapshots (`clearPersistedNotePreviews` in `shared/lib/storage`). `get_tree` never reads note bodies — Feed is name-sorted (file names are time-prefixed) and the UI re-sorts by front-matter timestamps from previews. The full cache/invalidation design (and the deferred TanStack Query decision) is documented in `docs/architecture/07-frontend-caching.md`.
- **Editor saves are debounced** (400ms). `flushSave()` must be called before navigation away, profile switching, or app backgrounding.
- **`shouldNestNotesInNavigation`**: When `notesListMode === "nested"`, notes appear inline inside the folder tree instead of in a separate middle pane. This affects keyboard navigation, rendering, and the visible navigation items computation.
- **Context split ordering matters**: SelectionContext and EditorContext are above NotesTreeContext in the provider tree. NotesTreeContext consumes both to update selection/editor after CRUD ops. Don't reorder providers without understanding these dependencies.
