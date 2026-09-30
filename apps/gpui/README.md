# Type — native GPUI desktop

Native desktop shell over `type-core`, with a plain Markdown editor and modal
keyboard navigation. GPUI Kit 0.7.0 owns the controls, editor and Command palette.
The React Native mobile app and shared Rust services remain unchanged.

From the repository root:

```sh
npm run desktop:app
npm run desktop:build
npm run desktop:test
npm run desktop:bundle
```

Development uses its own app identity and notes root. To open a specific isolated
fixture: `npm run desktop:app -- --data-dir /absolute/path/to/fixture`.
`--production` deliberately opens existing Type app data. Do not run both desktop
shells against the same notes root while editing.

The macOS dev launcher builds a `.app` under `target/bundle` (or the configured
`CARGO_TARGET_DIR`), with the app icon and microphone usage description. It prints
the bundle path. `desktop:bundle -- --release` builds an **unsigned** production
bundle; signing, notarization, installer and updater cutover are not finished.
The legacy Tauri shell remains available via `desktop:tauri:app` and related
`desktop:tauri:*` scripts.

## Keyboard

- Cmd+K / Ctrl+K: grouped command palette; `mv ` moves notes and folders.
- Ctrl+W: switch navigation/editor (also Cmd+W on macOS).
- Tab in navigation: Stream / Folders. Tab in the editor belongs to editing.
- Cmd+N / Ctrl+N: new note; Cmd+S / Ctrl+S: flush to disk.
- Cmd+T / Ctrl+T: sidebar; Cmd+B / Ctrl+B: sidebar actions.
- Cmd+Backspace / Ctrl+Backspace: Trash; Shift added: confirmed permanent delete.
- Cmd+plus/minus/0 (Ctrl on other platforms): editor font size.
- Cmd+comma / Ctrl+comma: Settings; Cmd+Shift+L / Ctrl+Shift+L: lock.
- Navigation: arrows or j/k; h/l collapse/expand; Enter opens.
- Vim: i/a/I/A, o/O, v/V, hjkl/wbe, operators, counts, text objects, p/P,
  u, Ctrl+R and `/` search. Ctrl+J/K moves five rendered rows.

Native tests use their own temporary files:

```sh
cargo test -p type-gpui -- --test-threads=1
cargo check -p type-gpui
```

macOS is the migration target verified locally. Linux/Windows native runtime and
packaging still need validation. CPAL adds an ALSA development dependency on
Linux; the GPUI platform also needs its desktop graphics/window libraries.

See [migration status](../../docs/GPUI_MIGRATION_STATUS.md) for exact verification,
remaining work and the current handoff. The original Tauri app is kept during
cutover; this README does not claim full feature or release parity.
