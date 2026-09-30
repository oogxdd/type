# Type

Local-first Markdown notes: files on disk, working folders, optional Git/phone
sync, voice transcription and handwriting OCR.

Desktop is native Rust + GPUI Kit. Mobile is React Native/Expo. Both use the same
framework-free `type-core`. The GPUI migration is still in progress; see the
[handoff](docs/GPUI_MIGRATION_STATUS.md) for verified behavior and remaining work.

```sh
npm run desktop:app          # native macOS dev app, isolated notes
npm run desktop:build        # Rust build
npm run desktop:test         # native unit + headless functional tests
npm run desktop:bundle       # unsigned macOS .app
npm run desktop:release      # unsigned release .app; does not publish
```

Rust is pinned by `rust-toolchain.toml`. The dev launcher needs Python 3.11+.
Native desktop does not need Node dependencies; npm only provides command aliases.
Use `--data-dir /absolute/path` with `desktop:app` for a fixture. The default dev
identity is `com.digital.type2.gpui.dev`; `desktop:app:prod-data` deliberately opens
existing production data. Runtime verification currently covers macOS.

| Path | Role |
| --- | --- |
| `apps/gpui` | Native desktop shell |
| `apps/mobile` | Mobile app |
| `crates/type-core` | Domain, application, ports and adapters |
| `crates/type-ffi` | UniFFI exports for mobile |
| `apps/notes-mcp` | Filtered notes access and agent workspace |
| `packages/shared`, `packages/mobile-core`, `packages/note-document` | Shared mobile/editor/MCP contracts |

For mobile: `npm install`, then `npm run mobile:start` (mock) or
`npm run mobile:ios` (native). See [mobile](apps/mobile/README.md).
`npm test` and `npm run typecheck` cover TypeScript workspaces.

[Desktop and keys](apps/gpui/README.md) · [Architecture](docs/architecture/README.md)
· [Agent conventions](AGENTS.md) · [Build](docs/MAC_BUILD_AND_TEST.md)
· [Release status](docs/RELEASING.md) · [Notes MCP](docs/AI_NOTES_MCP.md)

The previous shell remains in `apps/desktop` during cutover and is accessible
through explicit `desktop:tauri:*` commands. GPUI signing, installers and updater
migration are not finished; existing desktop tag automation still builds Tauri.
