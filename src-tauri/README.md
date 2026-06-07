# src-tauri — Rust Backend

This is the Rust backend for the app, built on Tauri v2. The code is organised
using a pragmatic **clean / hexagonal architecture** so that core use cases can
move to a different shell later (e.g. UniFFI bindings for a React Native mobile
app) without rewriting domain logic.

## Directory layout

```
src/
├── lib.rs              Crate root — module declarations, shared constants,
│                       utility functions, and the public run() entry point.
├── main.rs             Binary entry point (calls lib::run).
│
├── domain/             Framework-free core DTOs and domain state.
│   └── notes.rs        Note tree, metadata, frontmatter, create/order args.
│
├── application/        Use-case services. Owns workflows and depends on ports,
│                       never on Tauri command handlers.
│   ├── notes.rs        Real note CRUD/tree/order workflows.
│   ├── profiles.rs     Profile use-case facade.
│   ├── security.rs     Lock/encryption use-case facade.
│   ├── recordings.rs   Recording/native capture/transcription facade.
│   ├── handwriting.rs  Attachment/OCR facade.
│   ├── import.rs       Import scan/start/status facade.
│   ├── git_sync.rs     Git sync facade.
│   ├── local_sync.rs   Local sync server facade.
│   └── platform.rs     Native platform facade.
│
├── ports/              Port interfaces and gateway traits.
│   ├── mod.rs          Module index.
│   ├── notes.rs        Note CRUD, tree, ordering.
│   ├── profiles.rs     Multi-profile management.
│   ├── security.rs     Encryption, locking, key derivation.
│   ├── recordings.rs   Audio recording & transcription.
│   ├── handwriting.rs  Handwriting OCR pipeline.
│   ├── git_sync.rs     Git sync (SSH/HTTPS, merge, history).
│   └── platform.rs     Platform-specific capabilities (theme, export).
│
├── adapters/           Adapter implementations (Rust/Tauri/filesystem-specific).
│   ├── mod.rs          Module index + crate-level re-exports.
│   ├── notes/          Filesystem-backed note storage + document codec.
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

### Why these layers?

| Layer | Role | Depends on |
|-------|------|------------|
| **domain** | Framework-free DTOs and domain state. | Nothing app-specific. |
| **application** | Use-case orchestration and policy. | `ports` + `domain`. |
| **ports** | Traits for outbound dependencies and gateway contracts. | `domain` types. |
| **adapters** | Concrete filesystem, git2, crypto, HTTP, native APIs. | `ports`, external crates, Tauri where needed. |
| **commands** | IPC transport, security gate, blocking-thread dispatch. | `application`, concrete adapters, Tauri. |

The key rule: **commands do not own business workflows**. They unlock-gate the
request, construct the relevant application service, and dispatch blocking work
when needed. Application services depend on traits, while adapters own Tauri
handles, filesystem paths, git2, HTTP, crypto, native APIs, and worker queues.

The notes domain is the strictest implementation: note DTOs live in `domain/`,
note use cases live in `application/notes.rs`, and filesystem/frontmatter/git
history/time/id/encryption dependencies are accessed through ports. Other
domains now follow the same command -> application -> port -> adapter direction
through gateway traits while their deeper persistence logic remains in adapters.

### Why split commands by domain?

Previously `commands.rs` was a single 1354-line file containing every Tauri
command handler. Splitting into domain modules:

1. **Readability** — each file covers one concern and fits on screen.
2. **Migration surface** — when swapping Tauri for UniFFI, you can migrate one
   domain at a time (e.g. swap `commands/notes.rs` while keeping the rest on
   Tauri).
3. **Parallel work** — contributors can work on different domains without merge
   conflicts in a single monolithic file.

### How commands reference use cases

Each command submodule imports its application service and concrete Tauri
adapter explicitly. The `generate_handler![]` macro in `commands/mod.rs` uses
qualified paths (`security::get_security_state`, `notes::read_note`, etc.) to
avoid ambiguity with identically-named adapter modules.

### Future: UniFFI migration path

The planned migration to React Native with `uniffi-bindgen-react-native`:

1. Keep `domain/`, `application/`, `ports/`, and most `adapters/` as-is.
2. Replace `commands/` with UniFFI `#[uniffi::export]` functions that construct
   the same application services.
3. The frontend moves from Tauri's IPC to UniFFI-generated TypeScript bindings.

Because the command layer is intentionally thin, this swap is mechanical rather
than architectural.
