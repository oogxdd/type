# src-tauri — Rust Backend

This is the Rust backend for the app, built on Tauri v2. The code is organised
using a **ports & adapters** (hexagonal) architecture so that the core business
logic can be migrated to a different shell later (e.g. UniFFI bindings for a
React Native mobile app) without rewriting domain logic.

## Directory layout

```
src/
├── lib.rs              Crate root — module declarations, shared constants,
│                       utility functions, and the public run() entry point.
├── main.rs             Binary entry point (calls lib::run).
│
├── ports/              Port interfaces (platform-agnostic trait definitions).
│   ├── mod.rs          Module index.
│   ├── notes.rs        Note CRUD, tree, ordering.
│   ├── profiles.rs     Multi-profile management.
│   ├── security.rs     Encryption, locking, key derivation.
│   ├── recordings.rs   Audio recording & transcription.
│   ├── handwriting.rs  Handwriting OCR pipeline.
│   ├── git_sync.rs     Git sync (SSH/HTTPS, merge, history).
│   └── platform.rs     Platform-specific capabilities (theme, export).
│
├── adapters/           Adapter implementations (Rust/Tauri-specific).
│   ├── mod.rs          Module index + crate-level re-exports.
│   ├── notes.rs        Filesystem-backed note storage.
│   ├── profiles.rs     JSON-file profile state management.
│   ├── security.rs     XChaCha20-Poly1305 encryption, Argon2 KDF.
│   ├── recordings.rs   Audio file handling, Whisper/AssemblyAI transcription.
│   ├── handwriting.rs  Image attachment handling, LLM-based OCR.
│   ├── git.rs          git2-based sync (fetch, merge, push, history).
│   └── ios.rs          iOS native integration (AVFoundation, ObjC interop).
│
└── commands/           Tauri command layer (thin wrappers, one file per domain).
    ├── mod.rs          App bootstrap (Tauri Builder, plugins, generate_handler!)
    │                   and the shared run_blocking_command helper.
    ├── security.rs     5 commands  — lock, unlock, enable, preferences, state.
    ├── platform.rs     2 commands  — native theme, file export sheet.
    ├── profiles.rs     8 commands  — CRUD, backup, export.
    ├── notes.rs        10 commands — tree, read, create, write, move, delete, rename, order.
    ├── recordings.rs   10 commands — native recorder, save, transcription queue, list.
    ├── handwriting.rs  3 commands  — save attachment, OCR queue, list jobs.
    └── git_sync.rs     8 commands  — SSH keys, status, history, connect, pull, push.
```

## Architecture rationale

### Why three layers?

| Layer | Role | Depends on |
|-------|------|------------|
| **ports** | Define *what* each domain can do via Rust traits. | Nothing — pure interface. |
| **adapters** | Implement *how* it's done (filesystem, git2, crypto, HTTP). | Port traits + external crates. |
| **commands** | Wire adapters to the current shell (Tauri `#[command]`). | Adapters + Tauri framework. |

The key benefit: **only the `commands/` layer knows about Tauri**. The adapters
are plain Rust functions that could be called from any context. When migrating
to UniFFI (for React Native) or another binding system, you replace `commands/`
with a new thin layer that exposes the same adapter functions through a
different mechanism — the adapters and ports stay untouched.

### Why split commands by domain?

Previously `commands.rs` was a single 1354-line file containing every Tauri
command handler. Splitting into domain modules:

1. **Readability** — each file covers one concern and fits on screen.
2. **Migration surface** — when swapping Tauri for UniFFI, you can migrate one
   domain at a time (e.g. swap `commands/notes.rs` while keeping the rest on
   Tauri).
3. **Parallel work** — contributors can work on different domains without merge
   conflicts in a single monolithic file.

### How commands reference adapters

Each command submodule starts with `use crate::*;` which pulls in all adapter
functions and shared types re-exported from `lib.rs`. The `generate_handler![]`
macro in `commands/mod.rs` uses qualified paths (`security::get_security_state`,
`notes::read_note`, etc.) to avoid ambiguity with identically-named adapter
modules.

### Future: UniFFI migration path

The planned migration to React Native with `uniffi-bindgen-react-native`:

1. Keep `ports/` and `adapters/` as-is.
2. Replace `commands/` with UniFFI `#[uniffi::export]` functions that call the
   same adapter layer.
3. The frontend moves from Tauri's IPC to UniFFI-generated TypeScript bindings.

Because the command layer is intentionally thin (most functions are 1–5 lines
delegating to an adapter), this swap is mechanical rather than architectural.
