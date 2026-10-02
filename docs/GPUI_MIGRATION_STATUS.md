# GPUI migration — handoff / live status

Updated: 2026-10-02. This is an unfinished migration; update this file after each milestone.

## Where to continue

- Branch: `codex/gpui-desktop`.
- Worktree: `/Volumes/KINGSTON/Projects/type/app/.worktrees/gpui-desktop`.
- Base: `081cc4cb`; core shell: `5ff01346`; handoff: `6bb5378a`; UI/keys/tests: `f1efa117`; launcher/CI: `e88e3635`; nested Stream calendar: `6997f7be`; Earlier click fix: `9f39b292`.
- New shell: `apps/gpui` (`type-gpui`). Existing `experiments/gpui-demo` is untouched.
- Original worktree has unrelated dirty files (`package.json`, `crates/type-core/examples`, `docs/VOICE_MEMOS_IMPORT.md`). Do not overwrite them.
- User wants progress committed along the way. On 2026-10-01 the user requested
  setup and release work for the native updater. The user will test UI and feel;
  agents verify functionality. Production notes are not used for release tests.
- Current priority for this production trial is everyday text notes and the nested Stream. Audio recording and OCR are not important to the user now; automatic transcription matters somewhat but is not essential for cutover. Multi-note viewing and similar extras are outside the requested core scope.

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

### Ordinary folder workspaces — preview (2026-10-02)

Implementation in `.worktrees/gpui-open-folders`, branch
`codex/gpui-open-folders`, based on `codex/gpui-release-0.4.8` (`22013349`).
Type → Open Folder opens a session-only filesystem workspace without profile,
system-folder or Git setup. Content-based UTF-8/UTF-16 text detection includes
hidden/config files; binary files show an unsupported message. Existing files
autosave, preserving encoding/BOM/CRLF and checking the disk baseline before
replacement; conflicting drafts retain their tabs. Creation/move/delete remain
outside this workspace.

Workspace tabs use Kit's Dock tab primitives below the native titlebar, with a
Home tab, per-folder close and shared resizable-pane widths. With Home alone
the tabs disappear. Both editors share gutter, highlight and modal-cursor
rendering. Following the user's preview feedback, there is no status bar or Vim
mode/toggle label: folder name and unified tree/file refresh are at the top of
the sidebar, and a quiet Saved indicator occupies the editor's bottom right.
The user explicitly chose tabs below the window controls after trying inline
native-titlebar tabs.

All 59 GPUI tests pass (35 library, 24 native), including real input/Vim/autosave,
text/encoding preservation, conflict retention, tab mouse clicks, matching
gutter geometry, unified refresh, full-height panes and header alignment after
resizing/switching.
macOS dev preview only; other platforms and production/release are untested.
Leave running dev windows open for the user's inspection.

### Native release 0.4.8 (2026-10-02)

The user requested a locally built GPUI release. Release branch
`codex/gpui-release-0.4.8` starts at current `origin/main` (`aa02e879`) and
includes the tested capture/navigation correction from `d4e22991` as `200e4a48`.
GPUI manifest/lock version is 0.4.8; release notes are in
`docs/releases/gpui-v0.4.8.md`. Local release-script tests passed (9 tests). This Mac has the Developer ID
identity and Sparkle key, but Apple notarization credentials/profile are absent;
the signed universal candidate will be built by the configured GitHub workflow.
All 47 GPUI tests and all CI checks passed. The CI candidate was cancelled at
six hours after DMG submission stalled; the same tag was packaged locally.
Published 0.4.8 via promotion `37019377691`; signatures, app/DMG notarization,
Gatekeeper, both binary architectures, installer contents, checksum and live
Sparkle feed/archive signatures passed. Live versions: 0.4.8/0.4.7/0.4.6;
legacy Latest remains desktop-v0.8.1. Local Apple credentials are configured in
Keychain. New preflight/profile support and bounded notarization/CI safeguards are
integrated for subsequent releases (17 release-script tests pass).
See docs/RELEASING.md for local/CI recovery and exact integration status.


### Preserve manually scrolled navigation during polling (2026-10-02)

Background refresh no longer calls `select_row` after reconciliation. That
helper reveals the selected row; polling every three seconds therefore pulled
navigation back to a distant selected folder. `rebuild_navigation` already
preserves selection without scrolling. Explicit creation, view switching and
navigation retain their reveal behavior.

A native regression creates 80 synthetic folders, selects the last one, scrolls
back to the top, and checks selection/scroll position across three refreshes.
It also verifies an explicit reveal still scrolls. Before the fix the test
reproduced a jump from 0 to -1988 pixels on the first refresh.
After the fix all 47 GPUI tests pass (28 library, 19 native); formatting and
diff checks pass. The local Dev preview is rebuilt; installed apps are unchanged.


### Cmd+N capture and stable gutter (2026-10-02)

Implemented in the `gpui-line-sync` worktree (`codex/gpui-release-0.4.7`).
Cmd+N now persists an empty Stream note immediately, selects it under expanded
Today and focuses its editor in Insert mode. Empty notes show `New note`; live
sidebar titles use up to five words from the first nonempty prose/heading line,
skipping tag-only lines. Saving keeps the same path/editor identity. Creation
and edits invalidate obsolete background snapshots; tree repaints with unchanged
selection no longer reopen a previously selected note. Untouched empty captures
remain real notes; the existing dirty-empty-on-leave cleanup remains in place.
The number gutter reserves two digits for 1–99 lines, growing at 100/1000/etc.

Validation: 46 GPUI tests pass (28 library, 18 native), including real Cmd+N from
Folders during an in-flight refresh, native text input, immediate title changes,
flush/refresh focus stability, repeated Cmd+N and digit-width boundaries.
Formatting and diff checks passed. Tests use synthetic temporary profiles.
No production app replacement, relaunch, release or publication performed.


### Current-line geometry synchronization (2026-10-01)

The user reported that Insert-mode Enter moves the caret before the current-line
fill follows. The earlier anti-flicker fallback retained old geometry; Kit only
publishes fresh cursor/range geometry during editor paint. The editor now paints
before the highlight reads geometry, within two reserved paint layers so the
later-painted highlight still appears behind text, selection and native caret.
The custom Normal/Visual cursor retains its own foreground layer. Removed the
stale-caret fallback. No editor text/layout engine is duplicated or double-painted.

The synthetic typing regression now checks exact first-frame row position in
Insert mode, real Enter insertion, Unicode, soft wrapping and enough newlines
to scroll, with line numbers both on/off. It also checks the visible native caret
stays above the highlight. Position checks fail on the previous renderer and
pass with the paint-order correction. All 43 GPUI tests pass locally; formatting
and diff checks passed. Remote CI and the corrective release are pending.
This change is committed separately from updater/release preparation, as the
user requested. No installed app or real notes were used for these tests.

### Native update channel live (2026-10-01)

- Published `gpui-v0.4.6`: https://github.com/oogxdd/type/releases/tag/gpui-v0.4.6
  Candidate run `36879405095` and promotion `36909822428` succeeded. Source is
  immutable merge `73f32c03`; PRs #12/#14 passed all CI before merging.
- Dedicated signed feed is live under `gpui-updates/appcast.xml`. Its signature,
  version, enclosure URL and bundled public key/feed URL were independently
  verified after publication. Legacy latest remains `desktop-v0.8.1`.
- Downloaded the real 45,063,112-byte DMG and verified manifest commit/SHA-256,
  Sparkle archive/feed signatures, nested codesign, app/DMG staples, Gatekeeper
  acceptance and arm64/x86_64 slices. SHA-256 is
  `6d1012ef3052f58bf7e7d5aca46fa50eede163339d893d52f6f72d61a06955c1`.
- Fixture PR #15 / run `36880471771` produced two Developer ID signed/notarized
  isolated apps. Real UI update 0.0.1 → 0.0.2 completed: replacement, relaunch,
  exact Unicode text preservation, new plist version and valid post-update
  signature/staple confirmed. Test prerelease is clearly TEST ONLY and never
  latest; production key/feed and real notes were not used by these fixtures.
- User clarified that general app testing is unnecessary; priority is being
  able to install now and receive subsequent updates. The actual candidate was
  inspected as an artifact, without opening production notes or restarting the
  user's app. Comprehensive editor/UI smoke and Intel runtime execution were
  not claimed; Intel remains a runtime verification limitation.
- First installation from GPUI Dev or legacy Tauri is manual using the 0.4.6
  DMG. Subsequent signed GPUI releases use Settings → Updates. Dev bundles
  intentionally have no updater. Current-line typing flicker was fixed before
  PR #12 merged; the installed Dev bundle contains it, but the already-running
  process needs a normal restart. Local build + manual artifact upload remains
  documented in `docs/RELEASING.md`.

### Isolated updater fixtures (2026-10-01)

PR #14 was merged as `73f32c03`; all macOS/Rust/TypeScript checks passed.
Immutable `gpui-v0.4.6` points to that commit; candidate run `36879405095` is
building. The old 0.4.5 tag has no draft or public feed change.

Added an explicitly dispatched, main-only fixture workflow. It produces two
universal signed/notarized Cocoa apps using the real production bridge with
only the bundle-identity guard changed, a disposable fixture signing key,
separate HTTPS feed and clearly labelled TEST ONLY prerelease (never latest).
The fixture saves only synthetic text under `/private/tmp`; it does not link
the core or discover production roots. This avoids relying on CLI overrides
surviving Sparkle relaunch. Fixture compilation is included in native release
tests; actual replacement/relaunch and candidate notarization remain pending.

### First-candidate packaging correction (2026-10-01)

The `gpui-v0.4.5` candidate run `36874580320` passed functional checks and
Developer ID import, then stopped before building because macOS Bash 3.2
rejects an empty argument array under `set -u`. No draft or public update was
created. CI and the documented local-build alternative now use positional
arguments, including when there is no previous feed. The tag stays immutable;
the corrected candidate is version 0.4.6. A regression executes the actual
packaging step with the system Bash for both absent and existing feeds.
All 43 GPUI tests, 94 core tests and 9 release/native tests pass locally. The
packaging regression fails on the original workflow and passes after the fix.
The installed `Type GPUI Dev.app` contains the highlight correction; the already
running process was left alone and needs a restart to load it. Original dirty
checkouts were left untouched. Signing/notarization and isolated old→new update
verification remain pending.

### Current-line typing flicker (2026-10-01)

Before merging PR #12, the user reported that Highlight current line blinks
while typing. The underlay paints before Kit publishes the new editor geometry;
appending beyond the previous line or adding a newline can make the new cursor
range unresolvable for one frame. It now retains the last laid-out caret row
until fresh range geometry is available, with the proper scroll offset and
viewport clipping. Visual selections keep their explicit inclusive Vim head.
The fill remains behind text and does not depend on the native caret blink.

A headless regression checks the first painted frame after each typed character,
including Unicode, soft wraps and newlines, with line numbers enabled/disabled.
It fails on the original renderer and passes after the fix. All 43 GPUI tests passed locally, including the regression. PR #12 was merged as `e7911fb6` after all CI checks passed.

### First native release setup (2026-10-01, in progress)

- User authorized carrying out the updater setup and release instructions.
- Created the dedicated Sparkle `type-gpui` signing key in macOS Keychain;
  uploaded `SPARKLE_PRIVATE_KEY` and `SPARKLE_PUBLIC_KEY` to `oogxdd/type`.
  The temporary private-key export was removed and no private value was logged.
- Created `gpui-release` / `gpui-production` environments, restricted to
  `gpui-v*` tags / `main` respectively. Existing Apple signing/notary secret
  names are present; the local Developer ID identity is available.
- Integration worktree `.worktrees/gpui-release` merges GPUI head `0a51b9c1`
  with current remote main `33cd8bb2`; no conflicts. Original dirty worktree
  and installed/running apps remain untouched.
- Local validation after integration: all 42 native tests, 94 core tests and
  8 release/native bridge tests passed. Core network tests used loopback access.
- Integration commit `3763ad34` is pushed as `codex/gpui-release`; PR #12
  runs CI. TypeScript checks passed; Rust/macOS jobs are still running.
- Local Apple notarization credential services are absent; release signing and
  notarization will use existing GitHub secrets. Candidate and real isolated
  update verification are pending. No app was launched/restarted and no
  production notes were accessed during this setup.

### Native updater and release pipeline (2026-10-01)

- Local milestone commit: `feat(gpui): add Sparkle updater and staged native releases`.
  No push, merge or publication.

- Added a macOS Sparkle 2.10.0 bridge with Settings → Updates (manual check and
  device-local automatic-check toggle). Debug/dev launches and unconfigured
  bundles never start it. Release bundles embed a pinned/checksummed framework,
  HTTPS feed, public key, pre-extraction archive verification and signed-feed
  verification. Automatic installation is disabled; the user confirms updates.
- The shell flushes notes before checks/relaunch and pauses relaunch for a disk
  conflict, busy job, active capture or pending recording. The native delegate
  retains the postponed install handler; checking again after resolving the
  issue resumes it. Existing GPUI quit/recovery hooks remain in effect.
- Added universal Apple Silicon/Intel packaging, inside-out Developer ID signing
  of Sparkle helpers/framework/app, mandatory accepted notarization and stapling
  of app/DMG, `/Applications` installer link, signed archives/appcast and public
  release provenance. Local packaging never publishes anything.
- New `gpui-v*` candidate workflow tests and creates a draft; separate manual
  promotion verifies the candidate/baseline and publishes the dedicated
  `gpui-updates/appcast.xml` feed with seven daily rollout groups. The clock
  starts at promotion. Withdrawal removes/re-signs only the selected feed item;
  installed versions require a higher corrective release. Legacy Tauri tags
  and latest.json stay separate; the first GPUI install is manual.
- Checks: **41 GPUI tests** (27 library + 14 binary) passed, including a new
  synthetic save/conflict/recording barrier flow. **8 release/native tests**
  passed: configuration rejection, bundle symlinks/stale-code removal,
  promotion date/history, withdrawal, candidate checksum/feed drift, committed
  version validation, notarization rejection and native postponed-handler retry.
  Debug executable build passed. Actual GPUI+Sparkle bundle passed inside-out
  ad-hoc signing and `codesign --verify --deep --strict` in an isolated output.
  Real Sparkle tools passed archive signing, embedded release notes, signed-feed
  verification, tamper rejection and promotion re-signing using a synthetic app
  and ephemeral key. Framework SHA-256 extraction check, format and diff checks
  passed. Existing unused helper/variant and upstream `block` warnings remain.
- Read only repository metadata: public `oogxdd/type` already has the Apple
  signing/notary secret names, including the certificate password. Missing:
  `SPARKLE_PRIVATE_KEY` secret and `SPARKLE_PUBLIC_KEY` variable; key creation
  and configuration steps are in `docs/RELEASING.md`. No real signing key was
  generated, secret written, remote workflow run, app launched/restarted,
  production data accessed, tag pushed or release published.
- Remaining: configure Sparkle keys/environments, run the first signed and
  notarized candidate on CI, test Intel/runtime/Gatekeeper and real old→new
  installation/relaunch with isolated profiles before promotion. Production
  signing/notarization and live updater replacement cannot be claimed from
  ad-hoc/headless checks. Linux/Windows native updater support is not implemented.

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
- Follow-up after the user tried the installed app: `Earlier` appeared empty because it was collapsed and its section-row click was disabled. The user prefers it collapsed initially. It now shows a chevron and expands on click, revealing the months; `This week` remains an always-open label. The regression test simulates a real mouse click on `Earlier` with an older synthetic note.
- `cargo test -p type-gpui --offline -- --test-threads=1` passed: 27 library + 12 binary tests, including calendar boundary/filter tests and a headless UI test for expansion across tab switches. `cargo fmt -p type-gpui` and `git diff --check` passed.
- Normal debug build and separate `Type GPUI Dev.app` bundle succeeded. Bundle identifier is `com.digital.type2.gpui.dev`; its executable hash matches the freshly built binary. The Tauri production app was untouched. Agents have not launched GPUI against or modified the user's production data.
- Installed at `/Applications/Type GPUI Dev.app`; then atomically replaced that copy with the `Earlier` fix. Its executable SHA-256 matches the latest build (`b5dad621b04986f33ec277c37da15f97f5e766f7c26eab966feb49352d36828b`); `/Applications/Type.app` remains in place. The update did not restart GPUI or access notes; any already-running GPUI process still has the previous code until relaunched.
- After the `Earlier` fix, the full GPUI suite passed 27 library + 13 binary tests (40 total). The subsequent test refinement using an actual UI click passed as a focused headless test. Normal debug bundling, formatting, and diff checks passed.
- Remaining: user review of Stream appearance/feel; real-data smoke test for opening, editing, restarting, and sync if used. Native release signing/updater remain unfinished.

### Production-data trial

After the user makes their own backup, quit Tauri before editing the same notes root in GPUI. A normal double-click on the installed dev app uses its isolated dev data. To open the existing Type app data and configured notes root instead, launch:

```sh
open -n "/Applications/Type GPUI Dev.app" --args --dev --production
```

The `--production` argument switches the app-data path to `com.digital.type2`; it does not install over Tauri or change GPUI's separate bundle identifier. This launch has not been exercised on the user's data. Verify opening, editing, quitting/relaunching and any sync workflow used before relying on it exclusively.

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

Current bundle: `/Volumes/KINGSTON/Projects/type/app/experiments/gpui-demo/target/bundle/Type GPUI Dev.app`; the same build is installed at `/Applications/Type GPUI Dev.app`. Both include the clickable, collapsed-by-default `Earlier` fix, but the app was not relaunched after replacement. An older GPUI process may still be open; do not restart/close it unnecessarily while the user is testing. `.tmp/Type GPUI Dev.app` is obsolete.

## Next / remaining

1. Continue functional coverage: editor-only Tab, Normal/Visual paste/IME guards, move/rename after autosave, multi-selection, profile-switch flush, close/quit conflicts. Existing tests cover Ctrl+W, nav Tab, Unicode insert/save, Visual inclusive selection and mode preservation, grouped palette confirmation, backdrop click, filesystem conflicts/collisions, date groups and pure DnD.
2. Stream/Folders expansion now survives switching views. Confirm the nested Stream presentation with the user; headless tests do not judge appearance.
3. Lower priority for the user's current text-notes cutover: retain failed recording bytes + retry (`pending_recording` is not populated on stop), and add automatic processing after capture/import/sync respecting settings. Recording/OCR are not important to the user now; transcription is useful later but manual Queue is acceptable for the trial. No microphone permission/test has been performed. Validate filename format / OCR provider settings when revisiting these workflows.
4. Review profile rename/forget and standalone folder creation. Profile rename is now available under Settings → Working folders; profile deletion and standalone folder creation have no UI. Security panic reset clears profiles via reload, but needs a functional isolated-fixture test. Optional extension policy needs review before production use.
5. Root app/dev/build scripts target GPUI; explicit `desktop:tauri:*` aliases and `desktop:dmg:dev` retain Tauri. Local `desktop:release` emits an unsigned `.app`; `desktop:release:package` and the native candidate workflow build universal signed/notarized DMGs with Sparkle. Python >=3.12 is configured in release/CI (launcher alone needs >=3.11). Real Developer ID/notary and installer validation await the first candidate; isolated ad-hoc bundle verification passed.
6. CI adds native macOS tests/bundle; Linux Rust job excludes type-gpui so Tauri/core checks keep their existing dependencies. Remote CI and Linux/Windows runtime remain unverified.
7. Native updater, signing/notarization, universal installer and draft → promote/withdraw pipelines are implemented; see the updater milestone and `docs/RELEASING.md`. Configure Sparkle keys and complete a real signed/notarized old→new smoke test before production promotion. `desktop-v*` remains the legacy Tauri channel; GPUI uses `gpui-v*` plus its dedicated feed. No publication is authorized by implementation alone.
8. Keep this note current and commit progress in this branch. No merge, PR or release requested.

## H1/H2/H3 feasibility (investigation only)

GPUI rendering can support mixed-size text in principle, but stock Kit Editor 0.7 is a source editor with uniform font size and line height. `HighlightStyle`/text decorations expose color, weight, italic, underline, etc., not per-range font size. Proper large headings require editor layout extensions (variable row heights, wrapping, hit-testing, selection and cursor/scroll geometry), or a different document renderer. No heading-size feature implemented. Reference: https://gpui-kit.com/component/editor/ and local cached `gpui-pre-0.3.7/src/style.rs`, `gpui-component-0.7.0/src/input/editor.rs`.


## Folder-based profiles (2026-10-01)

GPUI now has one folder selection surface: Settings → Profiles. Removed the
General → Notes location card and the command that moved the active notes root.
The native picker and a typed absolute/`~/` path both register a folder in place;
new paths create that exact folder. There is no extra `notes/` nesting. Legacy
managed profiles need their `profiles/<id>/notes` child; selecting a recognizable
parent returns a hint rather than accidentally opening backups as notes.

`.type/profile.json` carries portable identity/name, while the existing
app-local registry stores registered paths and active selection. Existing Git,
settings and Markdown stay in place. Rename persists the folder name metadata;
remove forgets registration only (one entry must remain). Show in Finder reveals
the folder for manual relocation. Opening a moved folder restores its identity
and replaces the unavailable old registration. Core registry reads no longer
recreate missing registered folders, and legacy auto-discovery happens only at
bootstrap so forgotten managed profiles do not reappear on every launch.

Checks use synthetic fixtures: existing repository preservation, exact new path,
canonical-path deduplication, forget/reopen, Finder relocation, portable rename,
invalid input/legacy-parent rejection, and native modal switch with draft flush.
The production `123fresh` layout was inspected read-only; its notes root is
`/Users/digital/Library/Application Support/com.digital.type2/profiles/123fresh/notes`.
Legacy Tauri/mobile management UI and move APIs are retained during cutover.

Validation: all 94 core tests and all 42 GPUI tests passed. Core network tests
ran outside the sandbox to permit loopback sockets. Native build with
`gpui-kit/test-support` and `git diff --check` passed. Rebuilt the dev bundle and
atomically updated `/Applications/Type GPUI Dev.app` (binary hash verified);
the running app was left open. Restart it to use the new Profiles controls.
