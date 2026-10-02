# AGENTS.md

## Start here

Type is a local-first Markdown notes app. Native GPUI desktop and React Native
mobile share `crates/type-core`. Read `docs/GPUI_MIGRATION_STATUS.md` before
continuing the unfinished desktop migration; update it with commits, checks and
remaining work. The user will test UI/feel; agents should verify functionality.

## Code map

- `apps/gpui`: GPUI Kit 0.7.0 desktop. `workspace.rs` owns profiles, navigation,
  editor buffers and autosave; `commands.rs` owns palette/modal/action dispatch;
  `ui.rs` composes panes; `cursor.rs` paints modal cursors; `jobs.rs` adapts
  background services and CPAL capture. Library modules contain pure navigation,
  keyboard, document and Vim logic plus the core backend seam.
- `crates/type-core`: `domain / application / ports / adapters`. Shells call
  application services with concrete adapters and `AppEnv { app_data_dir,
  documents_dir }`. Core must not depend on UI frameworks.
- `apps/mobile`: Expo/React Native. See its README and `GESTURES.md`.
- `crates/type-ffi`, `packages/mobile-core`: UniFFI + typed mobile bridge. Changes
  to exports must keep `raw-core.ts` aligned and regenerate bindings on a Mac.
- `apps/notes-mcp`: standalone Node/stdio filtered notes server.
- `packages/shared`, `packages/note-document`: platform-free domain/Markdown/tag
  contracts. Keep core and TS constants aligned.
- `apps/desktop`: retained previous shell. Default desktop scripts use GPUI.

One root Cargo workspace/lock/target; npm workspaces for TypeScript packages.

## Desktop invariants

- Application chords have one owner in `keyboard.rs` and one window-scoped
  `App::intercept_keystrokes` subscription before Kit's native action dispatch.
  Raw key listeners run after matched bindings and cannot reliably own Tab/Esc.
- Ctrl+W switches nav/editor, including macOS. Tab cycles **Stream / Folders**
  only in navigation. Cmd+K uses native Command groups. Outside click dismisses
  the palette and consumes the entire click, including events on underlying UI.
- Editor is plain Markdown. Insert uses native IME/text input; Normal/Visual are
  readonly except during explicit modal edit effects. Visual head is inclusive
  and separate from the engine's selection endpoint. j/k use rendered rows;
  linewise operators use logical lines. Preserve Unicode literal input.
- Saves debounce 400ms. Flush before leaving, switching profiles, backgrounding,
  closing or sync. External-body conflicts retain drafts. Dirty empty notes are
  removed only on leaving, after checking the disk baseline.
- Tests use synthetic temporary profiles, never the maintainer's notes. Dev
  identity is `com.digital.type2.gpui.dev`; production data requires an explicit
  `--production`/`desktop:app:prod-data` launch. Do not run two shells against the
  same root while editing. Do not restart an app the user is testing unnecessarily.

## Storage and security

- Each profile has a configurable notes root. Owned content lives under `_system`:
  `stream`, `archive`, `agent`, `me`, `reviews`, `_recordings`, `_handwriting`,
  `_attachments`. `_system` itself, internal agent/memory/storage folders and
  dot entries must not appear in navigation. Stream is chronological and has no
  `.notes-order.json`; user folders preserve the core's persisted order.
- Folder creation is currently implicit in note creation/move destination paths.
  Do not invent a backend create-folder endpoint. Preflight collisions and
  self/descendant moves; never rely on Unix rename overwrite behavior.
- Folder Trash (`_system/archive`) differs from frontmatter `archived_ms`;
  `reviewed_ms` is another independent marker. Preserve unknown frontmatter.
- `.type/settings.json` syncs; `.type/device.json` holds local Git credentials
  and pinned host key; app-data `config.json` holds local API keys. Preserve
  omitted existing settings. Never write credentials into synced notes.
- Per-folder `transcription_mode` routes device work; use its effective fallback.
  Device-local `transcription_provider` chooses Whisper/AssemblyAI for desktop;
  unknown/absent values fall back to local Whisper, never silent cloud upload.
- Encryption covers note bodies only; filenames/frontmatter stay plaintext.
  Core content commands must reject locked access. Never persist plaintext
  recovery/previews for encrypted bodies. Panic password resets local data and
  requires dropping shell buffers/state. Security config lives in app data.
- Old flat layouts are not migrated automatically. See
  `docs/FOLDER_STRUCTURE_MIGRATION.md`. Keep migration compatibility spellings.

## MCP privacy and observer

All read output passes through `apps/notes-mcp/src/projection.ts`. Never expose
raw previews or filenames. Leading hashtag runs and `:::` containers are tags;
mid-line hashtags are prose. `skip-ai` hides its span/subtree; note-wide
`tags: [skip-ai]` hides the note. Unterminated containers extend through EOF;
malformed opener attributes withhold the note. Registry colors are advisory,
never a privacy or rendering gate. Standalone MCP does not support encrypted
notes. CRUD is confined to `<root>/_system/agent`; Stream is read-only.

Keep Markdown schema and tag validation aligned with `packages/note-document`
and `packages/shared/src/tags.ts`. Use `npm run mcp:build`, `npm run mcp:test` and
`node scripts/test-notes-mcp.mjs` for relevant changes.

Before changing personal memory, read `docs/PERSONAL_AGENT.md`,
`docs/PERSONAL_AGENT_IMPLEMENTATION.md` and `docs/OBSERVER_MCP.md`; update the
implementation journal. References use UUID + semantic area, fragment references
pin filtered source revisions, and generated/internal history must never become
independent primary evidence. Bootstrap instruction documents are independent
of recent-memory pagination. Memory round-trips use the separate filtered
editable capability. Tests must use synthetic fixtures.

## Checks and releases

`cargo test -p type-gpui -- --test-threads=1` covers native functional flows.
`cargo test -p type-core --lib` covers core changes; `npm test` / typecheck cover
TypeScript changes. Run appropriate checks once they pass; document untested
platforms/workflows. macOS CI tests GPUI; Linux workspace tests exclude it.

`desktop:release` creates an unsigned native bundle locally. Signed/notarized
universal DMGs with Sparkle use `desktop:release:package` or `gpui-v*` candidate
tags, followed by the separate promotion workflow. See `docs/RELEASING.md`.
For requested local releases, follow its **Agent preflight for a requested local
release** section: check the actual login Keychain, offer local Apple credential
setup when missing, and finish packaging before pushing a tag.
The legacy `desktop-v*` workflow targets Tauri. Do not send GPUI artifacts to its
updater, or publish/merge/create a PR without the user's instruction.
