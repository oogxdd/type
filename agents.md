# AGENTS.md

This document is for AI agents and developers who need to understand and modify this codebase.

## What this app is

A local-first markdown notes app built with Tauri v2 (Rust backend) + React (TypeScript frontend). It runs on desktop (macOS/Windows/Linux) and iOS. Notes are stored as `.md` files in a local folder tree. Optional Git sync lets you push/pull notes across devices. Audio recording with AssemblyAI transcription is supported. The app also supports optional at-rest note body encryption, lock screen, and panic-password local wipe.

## Tech stack

- **Frontend**: React 19, TypeScript, Vite, Tiptap (editor), DnD Kit (drag-and-drop), Tailwind + Shadcn/ui
- **Backend**: Tauri v2 (Rust) — filesystem ops, Git via libgit2, native audio recording on iOS
- **Build**: `npm run build` runs `tsc && vite build`. Rust: `cargo check --manifest-path src-tauri/Cargo.toml`

## System folders and storage

- Profile notes root is configurable per profile (`notes_root`). It can live in app data or any user-selected absolute path.
- Required system folders inside each `notes_root`:
  - `Feed` — default notes folder
  - `Archieve` — archive folder (typo is intentional and persisted)
  - `Recordings` — audio file storage folder
- `Recordings` is hidden from folder tree/navigation and used as backend storage.
- Legacy migrations are handled by backend:
  - `Unsorted` -> `Feed`
  - `_Recordings` -> `Recordings`
- `Feed` does not keep `.notes-order.json`.

## Security and encryption

- Security config is persisted in app data as `.notes-security.json` (not inside notes roots).
- When encryption is enabled:
  - note **body** content is encrypted at rest (`XChaCha20-Poly1305` envelope)
  - filenames and frontmatter remain plaintext by design
  - app starts locked by default and backend content commands reject requests until unlock
- Password handling:
  - unlock + panic passwords are Argon2id-hashed
  - unlock password derives an in-memory data key (never persisted in plaintext)
- Panic flow:
  - entering panic password on lock screen triggers backend local wipe
  - notes/profile/security files are reset
  - backend seeds 3 dummy notes in `Feed`
  - frontend clears localStorage and reloads

## How the frontend is structured

### Provider tree (App.tsx, ~72 lines)

App.tsx is a thin composition layer. All state lives in React contexts:

```
ThemeProvider                 — theme mode, notes list mode, editor font size
  SecurityProvider            — security state, unlock/lock/enable, auto-lock preference
    SecurityGate              — renders lock screen when encrypted state is locked
      ProfilesProvider        — profile list, active profile, per-profile sync settings
        GitSyncProvider       — git status, connect/pull/push operations, commit history (git log)
          SelectionProvider   — folder/note selection state, mobile selection helpers
            EditorProvider    — note editor state (wraps useNoteEditor hook)
              NotesTreeProvider — folder tree, CRUD operations, rename
                RecordingsProvider — audio recording, transcription queue, playback
                  AppShell    — UI rendering, DnD wiring, keyboard shortcuts
```

### AppShell.tsx (~600 lines)

Orchestrates desktop-specific behavior. Owns local UI state: `appMode` (notes/settings), `sidebarCollapsed`, pane sizes, settings section. Renders either `DesktopShell` or `MobileShell` depending on viewport. Wires up `useDragDrop()` and `useKeyboardNavigation()` hooks. Contains folder/note click handlers and context menu setup. Desktop pane content is delegated to `DesktopMiddlePane` and `DesktopRightPane`. Uses `SecurityContext.lockSecurity()` for the global lock shortcut (`Cmd/Ctrl+Shift+L`).

All child components (MobileShell, SettingsPanel, MobileSettingsScreen) consume contexts directly — no prop drilling. MobileShell receives only 3 props, SettingsDetailPane receives 2, MobileSettingsScreen receives 3.

### Contexts in detail

**ThemeContext** (`src/contexts/ThemeContext.tsx`, ~75 lines): Persists theme and notesListMode to localStorage. Toggles `document.documentElement` dark class. Provides font size controls (increase/decrease/reset with min 12, max 28).

**SecurityContext** (`src/contexts/SecurityContext.tsx`, ~200 lines): Loads security state from backend (`get_security_state`) and drives lock/unlock/enable flows. Exposes `enableSecurity`, `unlockSecurity`, `lockSecurity`, and `setAutoLockOnBackground`. Implements client-side panic reset handling by clearing localStorage + reloading when backend reports panic wipe. Also auto-locks on `document.visibilitychange` when encryption is enabled and auto-lock preference is on.

**ProfilesContext** (`src/contexts/ProfilesContext.tsx`, ~220 lines): Manages multi-profile support. Each profile has its own `notes_root` and sync settings. Exposes `activeProfileNotesRoot` and `setProfileNotesRoot(profileId, notesRoot)` to migrate a profile working directory. `syncSettings` is a single object (gitRemoteUrl, gitBranch, gitUsername, gitPassword, gitCommitMessage, lastSuccessfulSyncAt, assemblyAiApiKey, mobileAutoTranscriptionEnabled) persisted to localStorage keyed by profile ID. Takes a `flushSaveRef` prop to flush the editor before profile switching or path migration.

**GitSyncContext** (`src/contexts/GitSyncContext.tsx`, ~200 lines): Reads sync settings from ProfilesContext. Manages git status polling and connect/pull/push operations. Exposes `gitCommitHistory` loaded from backend `get_git_history` (real git log for current branch) plus `refreshGitHistory()`. `gitPull` accepts an optional `onAfterPull` callback (used to refresh the tree after pull).

**SelectionContext** (`src/contexts/SelectionContext.tsx`, ~127 lines): Owns all folder/note selection state: `selectedFolders`, `selectedNotes`, `activeFolder`, `activeNote`, `lastSelectedFolder`, `lastSelectedNote`. Provides setters for all selection state. Contains mobile helpers: `selectFolderForMobile`, `selectNoteForMobile`, `enterMobileHome`. Resets selection when `activeProfileId` or `activeProfileNotesRoot` changes. Consumed by most UI components and by NotesTreeContext for CRUD operations that update selection.

**EditorContext** (`src/contexts/EditorContext.tsx`, ~101 lines): Wraps the `useNoteEditor` hook, providing `noteContent`, `draftNoteContent`, `handleEditorChange`, `isSaving`, `lastSaveError`, `flushSave`, `clearNote`, `clearDraft`, `retrySave`. Owns `rightPaneRef`. Watches `activeNote` from SelectionContext to load/save notes. Handles flush-on-visibility/unload. Clears state when `activeProfileId` or `activeProfileNotesRoot` changes.

**NotesTreeContext** (`src/contexts/NotesTreeContext.tsx`, ~444 lines): Owns the folder tree, computed tree data (treeData, flatItems, visibleItems, orderedIds), and rename state. Provides all CRUD operations: createNewNote, deleteNotes, deleteFolders, moveNotesToArchive, rename. New notes are created through backend `create_note` and use the per-profile filename mode from sync settings (`utc_timestamp_slug`, `uuid_v7`, or `uuid_v7_prefix_slug`). Consumes SelectionContext and EditorContext to update selection/editor state after CRUD operations. Resets tree state when `activeProfileId` or `activeProfileNotesRoot` changes.

**RecordingsContext** (`src/contexts/RecordingsContext.tsx`, ~280 lines): Wraps `useAudioRecorder` hook. Manages recording target folder resolution, recording list/queue polling, audio playback (blob URL management), and auto-queue transcription timer. Takes `onRecordingComplete` callback prop wired in App.tsx to refresh tree and select the new note.

### Cross-context bridges

These are the trickiest part of the architecture:

1. **SecurityGate** (in App.tsx): Keeps provider-heavy app state unmounted while locked. This prevents accidental data fetches when encrypted mode is active and locked.

2. **FlushSaveBridge** (in App.tsx): A tiny component that reads `flushSave` from EditorContext and writes it into ProfilesProvider's `flushSaveRef`. This lets profile switching flush unsaved editor content.

3. **RecordingsProvider.onRecordingComplete**: Callback defined in App.tsx's `AppInner` component. When a recording finishes, it refreshes the tree (via NotesTreeContext) and selects the new recording's folder/note (via SelectionContext).

4. **GitSyncContext.gitPull({ onAfterPull })**: AppShell passes `() => refreshTree()` so the tree reloads after a pull brings new content.

5. **NotesTreeContext → SelectionContext/EditorContext**: CRUD operations (create, delete, archive) update selection and editor state. NotesTreeContext consumes both SelectionContext and EditorContext for this.

### Hooks

**useDragDrop** (`src/hooks/useDragDrop.ts`): Extracts all DnD Kit event handlers (dragStart, dragMove, dragOver, dragEnd, dragCancel). Handles folder reordering (with edge-snap detection, auto-expand on hover) and note reordering/moving. Takes tree state as explicit parameters for testability.

**useKeyboardNavigation** (`src/hooks/useKeyboardNavigation.ts`): Global keyboard shortcuts (Cmd+T toggle sidebar, Cmd+W switch panes, Cmd+J/K navigate panes, Cmd+N new note, Cmd+=/- font zoom, Cmd+0 reset font, Cmd/Ctrl+Shift+L lock app). Arrow key navigation for folders panel (with expand/collapse) and notes panel. Handles the "nested notes in navigation" mode where notes appear inline in the folder tree.

**useNoteEditor** (`src/hooks/useNoteEditor.ts`): Loads note content when activeNote changes, flushes previous note if dirty. Debounced autosave at 400ms. Tracks dirty/saving/error state. `flushSave()` for immediate save on navigation away. On note switch: empty dirty notes are auto-deleted; placeholder filename notes are auto-renamed to `...-<slug>.md` when content is sufficient for slugging (mode-dependent: UTC timestamp and UUID-prefix modes rename, pure UUID mode does not).

**useNotePreviews** (`src/hooks/useNotePreviews.ts`): Given an array of NoteEntry, fetches each note's metadata + content in parallel, returns preview objects (title, date, summary).

**useAudioRecorder** (`src/hooks/useAudioRecorder.ts`): Dual-mode: Web MediaRecorder for desktop, native iOS recording via Tauri commands. Handles recovery when native recording survives app backgrounding.

**useSettingsData** (`src/hooks/useSettingsData.ts`): Shared computed values for settings UI: `isRecordingBusy`, `syncActionLabel`, `canPull`/`canPush`/`canConnect`/`canQueue`, `recorderState`, `playButtonText()`. Consumed by both desktop and mobile settings sections to avoid duplication.

**useEdgeSwipe** (`src/hooks/useEdgeSwipe.ts`): Swipe-back gesture handler for mobile. Returns pointer event handlers to spread on root div. Takes `enabled` flag and `onSwipeBack` callback.

### Data layer

`src/data/notesApi.ts` wraps all Tauri IPC commands. Every function maps 1:1 to a Rust command. To swap backends, re-implement this module's exports.

Key commands: `getTree`, `readNote`, `createNote`, `writeNote`, `getNoteMeta`, `deleteItems`, `moveItems`, `renameItem`, `setOrder`, `getGitStatus`, `getGitHistory`, `connectGitRepo`, `gitPull`, `gitPush`, `getProfiles`, `setActiveProfile`, `createProfile`, `setProfileNotesRoot`, `listRecordings`, `saveAudioRecording`, `queueRecordingTranscriptions`, `readRecordingAudio`, `startNativeAudioRecording`, `stopNativeAudioRecording`, `nativeRecorderCapabilities`, `getSecurityState`, `enableSecurity`, `lockSecurity`, `unlockSecurity`, `setSecurityPreferences`.

### Layout modes

| Mode | Breakpoint | Shell | Notes panel |
|------|-----------|-------|-------------|
| phone | < 768px | MobileShell | Stack navigation |
| tablet | 768–1024px | MobileShell | Split view |
| desktop | > 1024px | DesktopShell | Resizable three-pane |

Detection in `src/mobile/useLayoutMode.ts`.

### Types

`src/types.ts`: FolderNode (recursive tree), NoteEntry, GitSyncStatus, GitCommitHistoryEntry, ProfileSyncSettings, RecordingListItem, RecordingQueueSnapshot, AppMode, PaneId, GitSyncAction, VisibleNavigationItem, `SecurityState`, `SecurityUnlockResult`.

`src/tree/types.ts`: TreeItem (DnD tree node), FlattenedItem (flattened for rendering).

### Desktop components

`src/desktop/DesktopShell.tsx` (~130 lines): Lightweight wrapper for desktop 2-pane/3-pane resizable layouts.

`src/desktop/DesktopMiddlePane.tsx` (~91 lines): Notes list pane. Renders `SortableContext` + `NoteRow` items, or `SettingsMiddlePane` depending on `appMode`. Consumes NotesTreeContext and SelectionContext directly.

`src/desktop/DesktopRightPane.tsx` (~57 lines): Editor pane. Renders `NoteEditor` or `SettingsDetailPane` depending on `appMode`. Consumes SelectionContext and EditorContext directly.

### Folder tree components

`src/components/FoldersPanel.tsx` (~272 lines): Top-level folders panel. Orchestrates tree rendering, recent section, "new folder" button, and drop zones.

`src/components/TreeRow.tsx` (~183 lines): Single folder row with drag-drop, rename input, expand/collapse toggle, tree guides, folder glyphs, note count badge.

`src/components/TreeNode.tsx` (~119 lines): Recursive component rendering a folder via TreeRow and its child notes (NavNoteRow) and subfolders.

`src/components/NavNoteRow.tsx` (~86 lines): Note row within the folder tree (for nested notes navigation mode), with drag-drop support.

`src/components/RecentTreeNode.tsx` (~69 lines): Recursive component for the "Recent" tab, rendering time-based folder nodes.

### Key utilities

`src/utils/treeOps.ts`: Tree build/flatten/find/insert/remove/reorder. Used by DnD and tree rendering.

`src/utils/format.ts`: Shared formatting utilities — `formatRecordingStatus`, `formatUpdatedAt`, `formatHistoryTime`, `getSyncHint`. Used by both desktop and mobile settings components.

`src/constants.ts`: `FEED_FOLDER_PATH = "Feed"`, `ARCHIEVE_FOLDER_PATH = "Archieve"` (note: the typo "Archieve" is intentional — it's the actual folder name in existing data), system folder detection, localStorage keys, settings section definitions.

### Mobile modules

- `src/mobile/navigation.ts` — Route types + useReducer-based navigation state machine
- `src/mobile/types.ts` — Shared constants (`FEED_FOLDER_PATH`, `ARCHIVE_FOLDER_PATH`, `SYSTEM_FOLDER_PATHS`) and helpers (`getDisplayFolderName`, `getDisplayRouteTitle`)
- `src/mobile/MobileShell.tsx` (~463 lines) — Thin shell: wires up navigation/action sheet/edge swipe hooks, renders phone layout (nav bar + route renderer + drawer) or tablet layout, plus action sheet/prompt/toast overlays. Only 3 props from AppShell.
- `src/mobile/TabletLayout.tsx` (~273 lines) — Tablet two-pane layout: left pane (folders or settings sections) + right pane (notes+editor or settings detail). Consumes contexts directly.

**Mobile hooks** (`src/mobile/hooks/`):
- `useMobileNavigation.ts` (~114 lines) — Navigation state (useReducer), route callbacks (popRoute, openNotesRoute, openEditorRoute, etc.), transition direction tracking
- `useActionSheets.ts` (~186 lines) — Action sheet state, folder/note action sheet openers, sheet action handler, rename prompt, delete/archive/toggle helpers
- `usePhoneNavHeader.ts` (~145 lines) — Computes phoneTitle, phoneLeftAction, phoneRightActions from current route
- `useRecentBuckets.ts` (~114 lines) — Groups allNotes into date-bucketed recent entries

**Phone screens** (`src/mobile/screens/`): Each route kind maps to a self-contained screen component:
- `PhoneHomeScreen.tsx` — Draft editor
- `PhoneFoldersScreen.tsx` — Folders/recent tab switcher
- `PhoneNotesScreen.tsx` — Folder notes list
- `PhoneRecentDateScreen.tsx` — Recent date bucket notes list
- `PhoneRecordingScreen.tsx` — Recording screen (consumes RecordingsContext)
- `PhoneEditorScreen.tsx` — Active note editor (consumes EditorContext + SelectionContext)
- `PhoneSettingsScreen.tsx` — Thin wrapper for MobileSettingsScreen
- `index.tsx` — `PhoneRouteRenderer` switch dispatching route.kind to screens

**Mobile components** (`src/mobile/components/`):
- `MobileFoldersScreen`, `MobileNotesScreen`, `MobileEditorScreen`, `MobileRecordingScreen`, `MobileRecentScreen` — Shared screen components used by both phone screens and tablet layout
- `MobileSettingsScreen.tsx` (~42 lines) — Tabs + section switcher, delegates to section components
- `MobileActionSheet`, `MobilePromptSheet`, `MobileTabBar`, `MobileNavBar`, `MobileToast` — UI primitives

**Mobile settings sections** (`src/mobile/components/settings/`):
- `SettingsHelpers.tsx` — Shared mobile settings primitives (Group, ChoiceRow, InputRow, StatRow)
- `MobileGeneralSection.tsx`, `MobileAppearanceSection.tsx`, `MobileSyncSection.tsx`, `MobileRecordingsSection.tsx`, `MobileSecuritySection.tsx`

**Desktop settings sections** (`src/components/settings/`):
- `SettingsGeneralSection.tsx`, `SettingsAppearanceSection.tsx`, `SettingsSyncSection.tsx`, `SettingsRecordingsSection.tsx`, `SettingsSecuritySection.tsx`
- `SettingsPanel.tsx` (~122 lines) — SettingsDetail is now a ~25-line switch dispatching to section components. Retains SettingsRow, SettingsMiddlePane, SettingsDetailPane, and type exports.

## iOS Widget (Quick Record)

A WidgetKit extension that lets users start a recording from the iOS home screen or lock screen.

### How it works

1. **Widget extension** (`src-tauri/gen/apple/type-widget/RecordWidget.swift`): A `systemSmall` StaticConfiguration widget showing a mic icon and "New Recording" label. The entire widget surface links to `type2://record`.

2. **URL scheme**: The `type2://` custom URL scheme is registered in `project.yml` via `CFBundleURLTypes`. When the widget is tapped, iOS opens the app with `type2://record`.

3. **Deep link handling** (`src/mobile/MobileShell.tsx`): A `useEffect` imports `@tauri-apps/plugin-deep-link` and listens for URL open events. When a URL containing "record" is received, it calls `openRecordingRoute` with `autoStart: true`.

4. **Auto-start recording** (`src/mobile/components/MobileRecordingScreen.tsx`): When the `autoStart` prop is true and recording is supported/idle, recording begins automatically via a one-shot `useEffect` (guarded by a ref to prevent re-firing).

### Files

- `src-tauri/gen/apple/type-widget/RecordWidget.swift` — Widget SwiftUI code
- `src-tauri/gen/apple/type-widget/Info.plist` — Widget extension plist
- `src-tauri/gen/apple/project.yml` — `type_RecordWidget` target + `CFBundleURLTypes` on `type_iOS`
- `src-tauri/Cargo.toml` + `src-tauri/src/lib.rs` — `tauri-plugin-deep-link` registration
- `src/mobile/navigation.ts` — `autoStart` field on recording route
- `src/mobile/MobileShell.tsx` — Deep link listener + passes autoStart through
- `src/mobile/components/MobileRecordingScreen.tsx` — Auto-start behavior

## Gotchas

- **"Archieve" typo**: The archive folder is spelled "Archieve" in the codebase and in persisted data. Do not "fix" this — it would break existing user data.
- **Feed folder semantics**: `Feed` is the default notes folder and does not keep `.notes-order.json`.
- **Recordings storage**: audio files live under hidden `Recordings/`; notes created from recordings can be in `Feed` or the selected folder and reference audio via frontmatter.
- **Filename lifecycle**: per-profile setting controls new note file names:
  - `utc_timestamp_slug` (default): `YYYY-MM-DDTHH-mm-ssZ-<slug>.md`
  - `uuid_v7`: `<uuidv7>.md` (no auto-rename to slug)
  - `uuid_v7_prefix_slug`: `<uuidv7-prefix>-<slug>.md`
  New notes may start with placeholder suffixes (`-note-...`, `-recording-...`, etc.) and then auto-rename to content slug when enough text is available in slug-capable modes. Slug extraction is Unicode-aware (keeps Cyrillic/Latin letters and digits) and ignores `NV_EMPTY_LINE_TOKEN_*` noise.
- **Empty note cleanup**: if a dirty note is emptied and then focus/selection moves away, it is auto-deleted.
- **Git sync uses libgit2**, not shell git. The Rust backend handles all git operations.
- **Git server support is generic**: `git://`, `ssh://`, and `https://` remotes are all supported. See `LOCAL_GIT_SERVER_LAN_HOTSPOT.md` for LAN/hotspot setup.
- **Lock guard is backend-enforced**: most app commands return a locked error while encrypted mode is locked; only security commands remain callable.
- **Encryption scope is note body only**: recordings/attachments are currently stored unencrypted.
- **Sync history UX**: settings now show commit history from real git log. This cannot reliably encode which device performed push/pull for every commit.
- **Editor saves are debounced** (400ms). `flushSave()` must be called before navigation away, profile switching, or app backgrounding.
- **`shouldNestNotesInNavigation`**: When `notesListMode === "nested"`, notes appear inline inside the folder tree instead of in a separate middle pane. This affects keyboard navigation, rendering, and the visible navigation items computation.
- **Context split ordering matters**: SelectionContext and EditorContext are above NotesTreeContext in the provider tree. NotesTreeContext consumes both to update selection/editor after CRUD ops. Don't reorder providers without understanding these dependencies.
