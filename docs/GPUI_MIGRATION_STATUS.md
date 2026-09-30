# GPUI migration — handoff / live status

Updated: 2026-10-01. This is an unfinished migration; update this file after each milestone.

## Where to continue

- Branch: `codex/gpui-desktop`.
- Worktree: `/Volumes/KINGSTON/Projects/type/app/.worktrees/gpui-desktop`.
- Base: `081cc4cb`; core shell: `5ff01346`; handoff: `6bb5378a`; UI/keys/tests: `f1efa117`; launcher/CI: `e88e3635`. Documentation cleanup is the following commit.
- New shell: `apps/gpui` (`type-gpui`). Existing `experiments/gpui-demo` is untouched.
- Original worktree has unrelated dirty files (`package.json`, `crates/type-core/examples`, `docs/VOICE_MEMOS_IMPORT.md`). Do not overwrite them.
- User wants progress committed along the way and now explicitly requested a push. No PR requested. Latest instruction: test functionally only; the user will test UI and feel. Prepare a clean handoff for a fresh agent.

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
- Latest changes (headless flows passed; visual/feel review belongs to the user): minimal sidebar/layout, explicit Ctrl+W, preserve mode across pane focus changes, line numbers, palette sections + occluding backdrop, custom cursor overlay. Added native GUI tests.

## Verification / current issue

- Earlier `cargo check -p type-gpui --offline`, native build, and **26 library tests** passed.
- Latest `cargo test -p type-gpui --offline -- --test-threads=1`: **33 passed** (26 library + 7 binary, including two real headless GUI flows). Test harness macro import issue fixed. Tab interception regression exposed/fixed: Kit bindings dispatch before raw key listeners; a single window-scoped `App::intercept_keystrokes` now owns shortcuts/Vim/navigation before native actions. Backdrop click over New note closes palette without creating a note; filtered group Enter executes the correct action.
- User will verify appearance/feel. Do not automate visual review unless asked again. Add functional geometry coverage if extending cursors (soft wrap, scroll, empty lines, Visual inclusive endpoint).
- `cargo build -p type-gpui --features gpui-kit/test-support --offline` passed. `cargo fmt -p type-gpui` and `git diff --check` passed. Unused helper/variant warnings remain (removed tag toolbar / palette button); there is also an upstream `block` future-compatibility warning.
- Full core/workspace test suite and remote CI were not run for this last milestone.

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

Synthetic playground exists at `.tmp/gpui-playground` (five Markdown notes, own profiles/root). The updated native app was bundled and launched via:

```sh
CARGO_TARGET_DIR=/Volumes/KINGSTON/Projects/type/app/experiments/gpui-demo/target \
  python3 apps/gpui/scripts/desktop.py dev --no-build --data-dir "$PWD/.tmp/gpui-playground"
```

Current bundle: `/Volumes/KINGSTON/Projects/type/app/experiments/gpui-demo/target/bundle/Type GPUI Dev.app`. CUA confirmed its standard window exists, but did not inspect its contents. The user then explicitly requested functional testing only. `.tmp/Type GPUI Dev.app` is an obsolete earlier bundle; do not use it. Do not restart/close the current app unnecessarily while the user is playing with it.

## Next / remaining

1. Continue functional coverage: editor-only Tab, Normal/Visual paste/IME guards, move/rename after autosave, multi-selection, profile-switch flush, close/quit conflicts. Existing tests cover Ctrl+W, nav Tab, Unicode insert/save, Visual inclusive selection and mode preservation, grouped palette confirmation, backdrop click, filesystem conflicts/collisions, date groups and pure DnD.
2. Preserve folder expansion across Stream/Folders switching. `set_view` clears roots; view-specific expansion is currently lost.
3. Finish retaining failed recording bytes + retry: `pending_recording` field exists and blocks close/profile switch, but is not populated on stop. `Capture::finish` and recording save currently consume bytes. No microphone permission/test has been performed. Add automatic processing after capture/import/sync respecting settings; presently only manual Queue is wired. Validate filename format / OCR provider settings.
4. Review profile rename/forget and standalone folder creation. Rename logic exists under `Config("profile_name")` but no obvious settings button; profile deletion and standalone folder creation have no UI. Security panic reset clears profiles via reload, but needs a functional isolated-fixture test. Optional extension policy needs review before production use.
5. Native macOS bundle/dev launcher exists and was exercised with `--no-build`; root app/dev/build scripts target GPUI, explicit `desktop:tauri:*` aliases retain Tauri. Validate a normal build/launcher and release bundling before claiming packaging finished. Launcher currently needs Python >=3.11 (`tomllib`); improve portability if appropriate. `desktop:dmg:dev` remains an explicit legacy alias; native bundling currently emits only unsigned `.app`.
6. CI adds native macOS tests/bundle; Linux Rust job excludes type-gpui so Tauri/core checks keep their existing dependencies. Remote CI and Linux/Windows runtime remain unverified.
7. Essential README/AGENTS/CLAUDE/build/release/Vim/architecture docs are now minimal and describe GPUI. Obsolete desktop updater/signing/rich-editor guides and the old architecture book were removed; core storage/sync/MCP and mobile guides remain. Tag release workflow still targets Tauri. Signing/notarization, installer and native updater are unfinished. Do not publish native artifacts through the old Tauri updater or release anything without an explicit request.
8. Keep this note current and commit progress in this branch. No merge, PR or release requested.

## H1/H2/H3 feasibility (investigation only)

GPUI rendering can support mixed-size text in principle, but stock Kit Editor 0.7 is a source editor with uniform font size and line height. `HighlightStyle`/text decorations expose color, weight, italic, underline, etc., not per-range font size. Proper large headings require editor layout extensions (variable row heights, wrapping, hit-testing, selection and cursor/scroll geometry), or a different document renderer. No heading-size feature implemented. Reference: https://gpui-kit.com/component/editor/ and local cached `gpui-pre-0.3.7/src/style.rs`, `gpui-component-0.7.0/src/input/editor.rs`.
