# GPUI migration — handoff / live status

Updated: 2026-09-30. This is an unfinished migration; update this file after each milestone.

## Where to continue

- Branch: `codex/gpui-desktop`.
- Worktree: `/Volumes/KINGSTON/Projects/type/app/.worktrees/gpui-desktop`.
- Base: `081cc4cb`; initial migration commit: `5ff01346`.
- New shell: `apps/gpui` (`type-gpui`). Existing `experiments/gpui-demo` is untouched.
- Original worktree has unrelated dirty files (`package.json`, `crates/type-core/examples`, `docs/VOICE_MEMOS_IMPORT.md`). Do not overwrite them.
- User wants progress committed along the way. No push or PR requested.

## User requirements

- Native GPUI desktop over existing framework-free `type-core`; mobile unchanged.
- Simple Markdown editor from the experiment is sufficient; full Tiptap parity unnecessary.
- Prioritize hotkeys and keyboard focus.
- Match the original Tauri screenshot: dark, spare two-pane screen, New note / mic / handwriting in sidebar header; tabs below; Settings and small status dot at bottom; no global top toolbar or duplicate title above editor.
- Tab names: **Stream / Folders**. **Ctrl+W** toggles nav/editor even on macOS. Tab toggles the two views only when navigation has focus.
- Insert: native thin blinking caret; Normal: translucent character block; Visual: blue block and selection, like original CSS.
- Cmd+K sections (original: Selection / Create / Navigate / View); outside click closes and must never activate the underlying button/row/editor.
- Restore line numbers.
- Investigate larger H1/H2/H3 only; do not implement yet.

## Implemented

- `gpui-kit = 0.7.0` (its engine dependency is `gpui-pre = 0.3.7`: different version lines).
- Real profiles / filesystem notes / metadata / security gates through core application services, not Tauri IPC.
- Lazy editors; 400ms autosave, flush on navigation/profile switch/close; external-body conflict check preserves draft; encrypted recovery on unavoidable quit.
- Stream date/week grouping, filters, Folders and Trash, hidden system folders, tree keyboard selection and DnD with path/collision preflight.
- Native Command component with search, note opening and `mv ` folder drill / create.
- Unicode-aware modal editing, Normal/Visual readonly to prevent native paste and IME mutation; native wrapped-row motion; clipboard/history/search.
- Core workflows exposed in commands/settings: Git connect/pull/push/checkpoint/history/SSH key, phone server/QR, backup/export, Apple Notes import, handwriting, queues, security enable/unlock/lock, per-folder and app configuration.
- CPAL microphone capture to WAV because core native recorder adapter is unsupported on desktop. Actual microphone/network flows have not been exercised.
- Debug identity `com.digital.type2.gpui.dev`; `--data-dir /absolute/path` supports isolated fixtures. `--production` opts into existing Type app data.
- Latest changes (not yet all validated): minimal sidebar/layout, explicit Ctrl+W, preserve mode across pane focus changes, line numbers, palette sections + occluding backdrop, custom cursor overlay. Added native GUI tests.

## Verification / current issue

- Earlier `cargo check -p type-gpui --offline`, native build, and **26 library tests** passed.
- Latest native code check reached only one error (private `render_cursor`); visibility has been fixed.
- New GUI-test compile currently fails: `#[gpui_kit::test]` recursively resolves `#[test]` because `use super::*` imports the facade macro named `test`. Fix macro/name resolution before rerunning; inspect `.cargo-test.log`.
- New UI and cursor geometry still need live visual verification, especially soft wrap, scroll, empty lines and Visual inclusive endpoint.
- Current source includes `apps/gpui/src/tests.rs`; `cargo fmt -p type-gpui` runs now.

## Commands

Run from this worktree. Reuse the already-built cache on the external disk:

```sh
export TMPDIR="$PWD/.tmp"
export CARGO_TARGET_DIR=/Volumes/KINGSTON/Projects/type/app/experiments/gpui-demo/target
cargo check -p type-gpui --offline
cargo test -p type-gpui --offline -- --test-threads=1
cargo build -p type-gpui --features gpui-kit/test-support --offline
"$CARGO_TARGET_DIR/debug/type-gpui" --data-dir "$PWD/.tmp/gpui-playground"
```

`test-support` on the build reuses artifacts produced by tests. Logs are ignored `.cargo-*.log` files. GUI launch may require sandbox escalation on macOS. Do not kill production Type.

Synthetic playground exists at `.tmp/gpui-playground` (five Markdown notes, own profiles/root). Temporary `.tmp/Type GPUI Dev.app` bundle with microphone usage description exists, but contains an older binary. Bare `type-gpui` processes may still be running from the earlier launch (one sandbox launch, one unsandboxed). Inspect only those processes, rebuild/copy bundle, then launch with `--data-dir` fixture and verify via CUA. A visible up-to-date bundle has not yet been confirmed.

## Next / remaining

1. Fix native test harness, run tests, verify sidebar/focus/Tab/Cmd+K/backdrop/cursors visually. Commit this UI milestone.
2. Preserve folder expansion across Stream/Folders view switching; verify multiselect and move targets after autosave/remap.
3. Finish retaining failed recording bytes + retry (field exists, capture stop currently consumes bytes); automatic processing after capture/import/sync respecting routing settings; validate configuration values.
4. Profile rename/forget and folder creation need explicit UI parity review. Security panic runtime clearing and optional extension policy need review before production use.
5. Add reproducible native macOS app bundling/dev launcher (Info.plist, icon, microphone permission), then change desktop npm entry points to GPUI while retaining explicit Tauri fallback. Root scripts currently STILL launch Tauri.
6. CI needs a GPUI native build/test job and Linux dependencies/exclusion decision (CPAL requires ALSA; GPUI requires desktop libraries). Linux/Windows runtime is unverified.
7. README/AGENTS/release workflow cutover. Do not feed native artifacts to the old Tauri updater or publish a release without an explicit request. Packaging/signing/updater are not finished.
8. Run appropriate final core/native checks, update this note with exact commits/results, leave runnable app for user.

## H1/H2/H3 feasibility (investigation only)

GPUI rendering can support mixed-size text in principle, but stock Kit Editor 0.7 is a source editor with uniform font size and line height. `HighlightStyle`/text decorations expose color, weight, italic, underline, etc., not per-range font size. Proper large headings require editor layout extensions (variable row heights, wrapping, hit-testing, selection and cursor/scroll geometry), or a different document renderer. No heading-size feature implemented. Reference: https://gpui-kit.com/component/editor/ and local cached `gpui-pre-0.3.7/src/style.rs`, `gpui-component-0.7.0/src/input/editor.rs`.
