# src-tauri — the desktop (Tauri) shell

This crate is the **Tauri v2 shell** around the shared Rust core. Almost all
business logic — the **domain / application / ports / adapters** layers — lives
in [`crates/type-core`](../../../crates/type-core), which is framework-free and
also powers the mobile FFI ([`crates/type-ffi`](../../../crates/type-ffi),
UniFFI bindings consumed by the React Native app). What remains here is the
IPC transport and the platform pieces only a Tauri process can provide.

## Directory layout

```
src/
├── lib.rs              Crate root: app_env() (tauri::AppHandle → type_core::AppEnv),
│                       macOS window-alpha helpers, and the public run() entry point.
├── main.rs             Binary entry point (calls lib::run).
│
├── adapters/
│   ├── platform.rs     Native theme + file-export sheet (Tauri/objc APIs).
│   ├── recordings.rs   TauriRecordingsAdapter: wraps the core RecordingsAdapter
│   │                   and overrides the three native-capture methods on iOS.
│   └── ios.rs          (iOS only) AVAudioRecorder/AVAudioSession recording and
│                       WKWebView termination recovery via ObjC interop.
│
├── application/platform.rs   Platform use-case facade (the one domain that
├── ports/platform.rs         stays shell-side: theme + export sheet).
│
└── commands/           Thin #[tauri::command] wrappers, one file per domain.
    ├── mod.rs          App bootstrap (Tauri Builder, plugins, generate_handler!)
    │                   and the shared run_blocking_command helper.
    ├── security.rs     lock, unlock, enable, preferences, state.
    ├── platform.rs     native theme, file export sheet.
    ├── profiles.rs     profile CRUD, backup zip, Documents export, app config.
    ├── notes.rs        tree, read/create/write, meta, previews, move/delete/
    │                   rename, order, timestamps, markers.
    ├── recordings.rs   native recorder, save, transcription queues, list.
    ├── handwriting.rs  save attachment, OCR queue, list jobs.
    ├── import.rs       Apple Notes scan / start / status.
    ├── git_sync.rs     SSH keys, status, history, connect, pull, push.
    └── local_sync.rs   local git-daemon server, mDNS discovery.
```

## How a command flows

```
frontend invoke("read_note")
  → commands/notes.rs        (lock gate, arg structs — from type_core)
  → type_core::application   (use-case service, depends on port traits)
  → type_core::adapters      (filesystem, git2, crypto, HTTP, workers)
```

Commands do not own business workflows. Each command file builds the relevant
`type_core` application service with the concrete core adapter, passing
`crate::app_env(&app)?` — the `AppEnv { app_data_dir, documents_dir }` seam
that replaced direct `tauri::AppHandle` usage when the core was extracted.
`ensure_security_unlocked_for_app` gates content commands while locked.

The `generate_handler![]` macro in `commands/mod.rs` uses qualified paths
(`notes::read_note`, `git_sync::git_pull`, …) to disambiguate command modules.

## What stays in the shell, and why

| Piece | Reason |
|-------|--------|
| `commands/` | Tauri IPC is the transport; the FFI crate is the other transport over the same services. |
| `platform` domain | Native theming and the file-export sheet need the Tauri window / ObjC. |
| iOS native capture | AVAudioRecorder + WKWebView recovery need the app's ObjC runtime. |
| `app_env()` | Path resolution (`app_data_dir`, `documents_dir`) is the only thing the core needs from Tauri. |

The "future UniFFI migration path" this README used to describe has happened:
`crates/type-ffi` exports the same use cases with `#[uniffi::export]` for the
React Native app. When adding a feature, put the logic in `type-core`, then
expose it twice — a thin command here, a thin export there.
