# GPUI migration — handoff / live status

Updated: 2026-10-01. This is an unfinished migration; update this file after each milestone.

## Where to continue

- Branch: `codex/gpui-desktop`.
- Worktree: `/Volumes/KINGSTON/Projects/type/app/.worktrees/gpui-desktop`.
- Base: `081cc4cb`; core shell: `5ff01346`; handoff: `6bb5378a`; UI/keys/tests: `f1efa117`; launcher/CI: `e88e3635`; nested Stream calendar: `6997f7be`.
- New shell: `apps/gpui` (`type-gpui`). Existing `experiments/gpui-demo` is untouched.
- Original worktree has unrelated dirty files (`package.json`, `crates/type-core/examples`, `docs/VOICE_MEMOS_IMPORT.md`). Do not overwrite them.
- User wants progress committed along the way. No PR or release requested. The user will test UI and feel; agents verify functionality. The user plans to try the separate GPUI bundle with production data after making their own backup.

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

## Settings sections (2026-10-01, implemented)

- Replaced the long settings page with the pre-migration two-pane structure: section navigation on the left, the selected section on the right. Uses existing Kit/component controls; no new UI dependency.
- Sections: General, Working folders, Appearance & editor, Sync, Voice transcription, Handwriting, Import & backup, Security, Keyboard. Each has grouped cards, readable labels, current values and help text; secrets stay masked. Provider-specific fields appear only for the selected provider. Filename format and provider/routing choices use preset buttons.
- Restored profile rename with the current name prefilled, Open Trash, font size/reset controls and background auto-lock preference. Preserved existing Git, phone pairing/QR, import/export/backup and processing actions. Transcription routing displays the legacy effective fallback; unknown desktop providers display local Whisper. Automatic queue processing remains unfinished and is identified as manual in settings.
- Settings keyboard navigation: j/k or arrows select sections, Enter/l/right enters the detail pane, Ctrl W switches panes, Escape or Back to notes returns to the open note. Modals restore the correct settings pane rather than focusing the hidden editor. Vim toggles persist even without an open note.
- Added two synthetic headless UI tests covering section/focus navigation, clicked theme/font/provider controls, API-key persistence outside synced settings, profile rename/modal dismissal, invalid-provider rejection and return to the original note. `cargo test -p type-gpui --offline -- --test-threads=1` passed: **35 tests** (26 library + 9 binary, including 4 headless UI flows). `cargo fmt -p type-gpui` and `git diff --check` passed. No UI/feel review or real microphone/network test performed; the user reviews appearance.
- `python3 apps/gpui/scripts/desktop.py bundle --test-support` passed; refreshed the existing `target/bundle/Type GPUI Dev.app` in the shared cache without restarting the running app. It picks up the new settings on the next launch. Existing unused-helper and upstream `block` warnings remain.
- Included with the editor appearance work in the user-requested commit `feat(gpui): refine settings and editor appearance`. No push performed. Remaining parity: tag registry settings, profile forget/delete, automatic queue processing, and native updater/release UI. Do not expose the previous shell updater in GPUI.

## Verification / current issue

### Nested Stream calendar (2026-10-01)

- Matched the user's Tauri nested navigation mode: `This week` contains every elapsed day (including empty days); `Earlier` contains month → ISO week → day → note. Weeks crossing months belong to the month containing Thursday. Notes stay inside the left navigation pane.
- Stream section labels are muted; note rows include archived/reviewed markers. Expansion is now retained independently when switching Stream and Folders. The old simpler date grouping remains in Trash.
- `cargo test -p type-gpui --offline -- --test-threads=1` passed: 27 library + 12 binary tests, including calendar boundary/filter tests and a headless UI test for expansion across tab switches. `cargo fmt -p type-gpui` and `git diff --check` passed.
- Normal debug build and separate `Type GPUI Dev.app` bundle succeeded. Bundle identifier is `com.digital.type2.gpui.dev`; its executable hash matches the freshly built binary. The Tauri production app was untouched. The new bundle was not launched, and production data was not opened.
- Remaining: user review of Stream appearance/feel; real-data smoke test for opening, editing, restarting, and sync if used. Native release signing/updater remain unfinished.

### Editor / window appearance (2026-10-01, implemented and launched for review)

- Implemented in the working tree: editor fills the right pane without the previous 40px side / 30px top / 24px bottom wrapper padding; the split layout spans the window height, including the top strip. Right pane has no 1800px maximum width.
- Replaced the custom drag strip with Kit TitleBar and its matching window options, including app-owned dragging and the native macOS titlebar double-click action (honors the system zoom/minimize preference).
- Added device-local Appearance & editor preferences for Line numbers, Collapse headings, and Highlight current line. Existing preference files retain their values and get enabled defaults for the new options. Folding changes update all cached editors and disabling expands folded text.
- Line numbers use smaller monospace text (72% of editor size, clamped to 10–14px), muted at 60% opacity. A shell gutter follows native editor geometry. Current-line fill is independent of number visibility.
- Fixed gutter geometry for wrapped and folded lines: Kit's IME hit-testing does not accumulate logical-line heights and hidden offsets can resolve to the next visible line. Number placement uses logical starts from the native visible-row range and deduplicates shared rendered positions; scrolling does not scan the entire document. Offscreen cursor rows do not highlight an unrelated visible line.
- Checks: `cargo test -p type-gpui --offline -- --test-threads=1` passed **38 tests** (27 library + 11 binary). New headless coverage verifies full-height pane geometry, a 3000px-wide window without the old width cap, Unicode wrapping, folding/unfolding, scroll alignment, reclaimed gutter width when numbers are disabled, and actual current-line fill with numbers hidden / highlight disabled / focus moved away. Extended settings persistence and backward-compatible defaults pass. `cargo fmt -p type-gpui` and `git diff --check` passed.
- Bundle refresh passed: `python3 apps/gpui/scripts/desktop.py bundle --test-support`. At the user's explicit launch request, the previous dev instance was quit normally, its exit confirmed, and the updated `Type GPUI Dev.app` launched with `dev --no-build --data-dir "$PWD/.tmp/gpui-playground"`. One running dev process confirmed on this isolated profile; production data was not used.
- Remaining for the user's review: UI/feel and native macOS double-click behavior (headless tests do not emulate the system zoom/minimize preference). All requested code changes, functional checks, bundling and launch are finished. Existing unused-helper / unused-variant and upstream `block` warnings remain. Included with settings in the user-requested commit `feat(gpui): refine settings and editor appearance`; no push performed.
- Follow-up: added 12px of left wrapper padding when Line numbers are disabled, per the user's request for more space before the text. Numbered layout retains its gutter width. Removed navigation's duplicate right border, which began below the 28px title strip; Kit's full-height resizable separator now owns the pane boundary. Both existing editor geometry tests passed after these changes, as did formatting and diff checks. Dev bundle refreshed and reopened normally on the same isolated playground for user review.
- Sidebar-hidden follow-up: added a 250px left inset (approximately ¾ of the default 330px sidebar). The editor's number/folding gutters move together into this inset while its right edge and height keep filling the window. Both editor geometry tests passed, including hidden-sidebar bounds; formatting and diff checks passed. Dev bundle refreshed and reopened normally on the same isolated playground for user review.

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

Current bundle: `/Volumes/KINGSTON/Projects/type/app/experiments/gpui-demo/target/bundle/Type GPUI Dev.app`. The bundle was refreshed with nested Stream on 2026-10-01 but not relaunched. An older dev process may still be open on the isolated playground; do not restart/close it unnecessarily. `.tmp/Type GPUI Dev.app` is obsolete.

## Next / remaining

1. Continue functional coverage: editor-only Tab, Normal/Visual paste/IME guards, move/rename after autosave, multi-selection, profile-switch flush, close/quit conflicts. Existing tests cover Ctrl+W, nav Tab, Unicode insert/save, Visual inclusive selection and mode preservation, grouped palette confirmation, backdrop click, filesystem conflicts/collisions, date groups and pure DnD.
2. Stream/Folders expansion now survives switching views. Confirm the nested Stream presentation with the user; headless tests do not judge appearance.
3. Finish retaining failed recording bytes + retry: `pending_recording` field exists and blocks close/profile switch, but is not populated on stop. `Capture::finish` and recording save currently consume bytes. No microphone permission/test has been performed. Add automatic processing after capture/import/sync respecting settings; presently only manual Queue is wired. Validate filename format / OCR provider settings.
4. Review profile rename/forget and standalone folder creation. Profile rename is now available under Settings → Working folders; profile deletion and standalone folder creation have no UI. Security panic reset clears profiles via reload, but needs a functional isolated-fixture test. Optional extension policy needs review before production use.
5. Native macOS bundle/dev launcher exists; normal debug build and unsigned dev bundling passed. Root app/dev/build scripts target GPUI, explicit `desktop:tauri:*` aliases retain Tauri. Validate release bundling before claiming packaging finished. Launcher needs Python >=3.11 (`tomllib`); improve portability if appropriate. `desktop:dmg:dev` remains an explicit legacy alias; native bundling currently emits only unsigned `.app`.
6. CI adds native macOS tests/bundle; Linux Rust job excludes type-gpui so Tauri/core checks keep their existing dependencies. Remote CI and Linux/Windows runtime remain unverified.
7. Essential README/AGENTS/CLAUDE/build/release/Vim/architecture docs are now minimal and describe GPUI. Obsolete desktop updater/signing/rich-editor guides and the old architecture book were removed; core storage/sync/MCP and mobile guides remain. Tag release workflow still targets Tauri. Signing/notarization, installer and native updater are unfinished. Do not publish native artifacts through the old Tauri updater or release anything without an explicit request.
8. Keep this note current and commit progress in this branch. No merge, PR or release requested.

## H1/H2/H3 feasibility (investigation only)

GPUI rendering can support mixed-size text in principle, but stock Kit Editor 0.7 is a source editor with uniform font size and line height. `HighlightStyle`/text decorations expose color, weight, italic, underline, etc., not per-range font size. Proper large headings require editor layout extensions (variable row heights, wrapping, hit-testing, selection and cursor/scroll geometry), or a different document renderer. No heading-size feature implemented. Reference: https://gpui-kit.com/component/editor/ and local cached `gpui-pre-0.3.7/src/style.rs`, `gpui-component-0.7.0/src/input/editor.rs`.
