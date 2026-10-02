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
bundle without an updater. Signed/notarized universal installers with Sparkle
are built by `desktop:release:package` or the candidate workflow; see
[releasing](../../docs/RELEASING.md).
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

## Open ordinary folders

**Type → Open Folder…** (Cmd+O / Ctrl+O) opens any existing folder in a separate
workspace tab below the window controls. The leftmost **Home** tab returns to
the profile workspace. The tab strip is completely absent when only Home is open. Open folders retain
their tree expansion and editor buffers during the session; opening the same
folder again selects its existing tab. Use the tab's × or Cmd+Shift+W /
Ctrl+Shift+W to close it.

The sidebar lists files and directories, loading subdirectories when expanded.
Text files are detected by content, regardless of extension (including JSON,
configuration files and files without an extension). UTF-8 and BOM-marked UTF-16
are supported. Markdown keeps its full frontmatter; JSON has syntax highlighting.
Binary files show an unsupported-format message. Symbolic links and text files
larger than 16 MB are not opened. Changes autosave after 400 ms, with an explicit
save available through Cmd+S / Ctrl+S. Navigation and closing
also flush changes. Empty files remain on disk. The original encoding, BOM and
CRLF line endings are preserved. Refresh the folder with its refresh button or
Cmd+R / Ctrl+R; clean buffers also refresh when the window becomes active.

An ordinary folder does not register a profile or initialize `_system`, `.type`
or Git. Profile note creation, move, trash and delete commands are unavailable
there. If a file changed externally, saving and closing stop while the local
draft remains in the editor. Copy the draft if needed, then refresh to reload
the disk version; reloading a dirty buffer asks before discarding edits.

The folder name and refresh live at the top of the sidebar. One refresh updates
both the tree and open files. A quiet save indicator sits in the editor's bottom
right corner, with no status bar. Vim and editor appearance are configured in
Home's Settings; both workspaces use the same line-number gutter, current-line
highlight and modal cursor.
Opened folders are not restored after restarting the app.

## Profiles

A profile points directly at a notes folder. In Settings → Profiles, choose a
folder in the native picker or enter an absolute path (`~/…` also works). An
existing folder opens in place, including its Git repository and `.type`
settings; a new path creates that folder, without an extra `notes/` child.
For a legacy managed profile, select `profiles/<id>/notes`, not its parent.

The folder carries its name and identity in `.type/profile.json`. The app keeps
the list of registered paths and the active selection in its device-local
`.notes-profiles.json`. Rename changes the display name, not the directory name.
Removing a profile only forgets its entry; files and Git history remain intact.
At least one profile stays registered.

Use **Show in Finder** to reveal the folder, and move it yourself after finishing
editing. Add its new path, then remove the old entry if still listed. A moved or
offline folder is not silently recreated. Opening its new path restores the
profile identity. This folder workflow is implemented in the GPUI shell; the
legacy Tauri/mobile folder-management UI keeps its existing APIs.
