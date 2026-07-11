# CLAUDE.md

The agent + contributor guide for this repository is **[AGENTS.md](./AGENTS.md)**.
Read it before changing anything — it covers the monorepo layout (Tauri desktop +
React Native mobile over one Rust core), the core's ports/adapters layout, the
desktop's store-based state layer, and the non-obvious gotchas (intentional
`Archieve` typo, filename lifecycle, debounced saves, transcription-mode
fallback, …).

For the Rust side specifically, see also
[apps/desktop/src-tauri/README.md](./apps/desktop/src-tauri/README.md) (Tauri shell),
[crates/type-core](./crates/type-core) (shared core), and
[packages/mobile-core/README.md](./packages/mobile-core/README.md) (mobile FFI bridge).

@AGENTS.md
