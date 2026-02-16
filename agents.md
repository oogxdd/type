# AGENTS.md

This document is for AI agents and developers who need to understand and modify this codebase.

## What this app is

A local-first markdown notes app built with Tauri v2 (Rust backend) + React (TypeScript frontend). It runs on desktop (macOS/Windows/Linux) and iOS. Notes are stored as `.md` files in a local folder tree. Optional Git sync lets you push/pull notes across devices. Audio recording with AssemblyAI transcription is supported.

## Tech stack

- **Frontend**: React 19, TypeScript, Vite, Tiptap (editor), DnD Kit (drag-and-drop), Tailwind + Shadcn/ui
- **Backend**: Tauri v2 (Rust) — filesystem ops, Git via libgit2, native audio recording on iOS
- **Build**: `npm run build` runs `tsc && vite build`. Rust: `cargo check --manifest-path src-tauri/Cargo.toml`

## How the frontend is structured

### Provider tree (App.tsx, ~64 lines)

App.tsx is a thin composition layer. All state lives in React contexts:

```
ThemeProvider              — theme mode, notes list mode, editor font size
  SessionsProvider         — session list, active session, per-session sync settings
    GitSyncProvider        — git status, connect/pull/push operations, sync history
      NotesTreeProvider    — folder tree, folder/note selection, editor state, CRUD
        RecordingsProvider — audio recording, transcription queue, playback
          AppShell         — UI rendering, DnD wiring, keyboard shortcuts
```

### AppShell.tsx (~890 lines)

Consumes all contexts. Owns local UI state that doesn't need sharing: `appMode` (notes/settings), `sidebarCollapsed`, pane sizes. Renders either `DesktopShell` or `MobileShell` depending on viewport. Wires up `useDragDrop()` and `useKeyboardNavigation()` hooks. Contains folder/note click handlers, context menu setup, and all render functions for the three desktop panes.

MobileShell and SettingsPanel still receive props from AppShell (not yet migrated to consume contexts directly).

### Contexts in detail

**ThemeContext** (`src/contexts/ThemeContext.tsx`): Persists theme and notesListMode to localStorage. Toggles `document.documentElement` dark class. Provides font size controls (increase/decrease/reset with min 12, max 28).

**SessionsContext** (`src/contexts/SessionsContext.tsx`): Manages multi-session support. Each session has its own notes folder and sync settings. `syncSettings` is a single object (gitRemoteUrl, gitBranch, gitUsername, gitPassword, gitCommitMessage, lastSuccessfulSyncAt, assemblyAiApiKey, mobileAutoTranscriptionEnabled) persisted to localStorage keyed by session ID. Takes a `flushSaveRef` prop to flush the editor before session switching.

**GitSyncContext** (`src/contexts/GitSyncContext.tsx`): Reads sync settings from SessionsContext. Manages git status polling, connect/pull/push with history tracking. History entries include before/after status snapshots. `gitPull` accepts an optional `onAfterPull` callback (used to refresh the tree after pull).

**NotesTreeContext** (`src/contexts/NotesTreeContext.tsx`, largest at ~570 lines): Owns the folder tree, computed tree data (treeData, flatItems, visibleItems, orderedIds), folder/note selection state, rename state, and the note editor (via `useNoteEditor` hook). Provides all CRUD operations: createNewNote, deleteNotes, deleteFolders, moveNotesToArchive, rename. Has mobile helpers: selectFolderForMobile, selectNoteForMobile, enterMobileHome. Resets tree state when activeSessionId changes.

**RecordingsContext** (`src/contexts/RecordingsContext.tsx`): Wraps `useAudioRecorder` hook. Manages recording target folder resolution, recording list/queue polling, audio playback (blob URL management), and auto-queue transcription timer. Takes `onRecordingComplete` callback prop wired in App.tsx to refresh tree and select the new note.

### Cross-context bridges

These are the trickiest part of the architecture:

1. **FlushSaveBridge** (in App.tsx): A tiny component that reads `flushSave` from NotesTreeContext and writes it into SessionsProvider's `flushSaveRef`. This lets session switching flush unsaved editor content.

2. **RecordingsProvider.onRecordingComplete**: Callback defined in App.tsx's `AppInner` component. When a recording finishes, it refreshes the tree and selects the new recording's folder/note.

3. **GitSyncContext.gitPull({ onAfterPull })**: AppShell passes `() => refreshTree()` so the tree reloads after a pull brings new content.

### Hooks

**useDragDrop** (`src/hooks/useDragDrop.ts`): Extracts all DnD Kit event handlers (dragStart, dragMove, dragOver, dragEnd, dragCancel). Handles folder reordering (with edge-snap detection, auto-expand on hover) and note reordering/moving. Takes tree state as explicit parameters for testability.

**useKeyboardNavigation** (`src/hooks/useKeyboardNavigation.ts`): Global keyboard shortcuts (Cmd+T toggle sidebar, Cmd+W switch panes, Cmd+J/K navigate panes, Cmd+N new note, Cmd+=/- font zoom, Cmd+0 reset font). Arrow key navigation for folders panel (with expand/collapse) and notes panel. Handles the "nested notes in navigation" mode where notes appear inline in the folder tree.

**useNoteEditor** (`src/hooks/useNoteEditor.ts`): Loads note content when activeNote changes, flushes previous note if dirty. Debounced autosave at 400ms. Tracks dirty/saving/error state. `flushSave()` for immediate save on navigation away.

**useNotePreviews** (`src/hooks/useNotePreviews.ts`): Given an array of NoteEntry, fetches each note's metadata + content in parallel, returns preview objects (title, date, summary).

**useAudioRecorder** (`src/hooks/useAudioRecorder.ts`): Dual-mode: Web MediaRecorder for desktop, native iOS recording via Tauri commands. Handles recovery when native recording survives app backgrounding.

### Data layer

`src/data/notesApi.ts` wraps all Tauri IPC commands. Every function maps 1:1 to a Rust command. To swap backends, re-implement this module's exports.

Key commands: `getTree`, `readNote`, `writeNote`, `getNoteMeta`, `deleteItems`, `moveItems`, `renameItem`, `setOrder`, `getGitStatus`, `connectGitRepo`, `gitPull`, `gitPush`, `getSessions`, `setActiveSession`, `createSession`, `listRecordings`, `saveAudioRecording`, `queueRecordingTranscriptions`, `readRecordingAudio`, `startNativeAudioRecording`, `stopNativeAudioRecording`, `nativeRecorderCapabilities`.

### Layout modes

| Mode | Breakpoint | Shell | Notes panel |
|------|-----------|-------|-------------|
| phone | < 768px | MobileShell | Stack navigation |
| tablet | 768–1024px | MobileShell | Split view |
| desktop | > 1024px | DesktopShell | Resizable three-pane |

Detection in `src/mobile/useLayoutMode.ts`.

### Types

`src/types.ts`: FolderNode (recursive tree), NoteEntry, GitSyncStatus, GitSyncHistoryEntry, SessionSyncSettings, RecordingListItem, RecordingQueueSnapshot, AppMode, PaneId, GitSyncAction, VisibleNavigationItem.

`src/tree/types.ts`: TreeItem (DnD tree node), FlattenedItem (flattened for rendering).

### Key utilities

`src/utils/treeOps.ts`: Tree build/flatten/find/insert/remove/reorder. Used by DnD and tree rendering.

`src/constants.ts`: `UNSORTED_FOLDER_PATH = "Unsorted"`, `ARCHIEVE_FOLDER_PATH = "Archieve"` (note: the typo "Archieve" is intentional — it's the actual folder name in existing data), system folder detection, localStorage keys, settings section definitions.

### Mobile modules

- `src/mobile/navigation.ts` — Route types + useReducer-based navigation state machine
- `src/mobile/MobileShell.tsx` — Orchestrates mobile screens, tab bar, nav bar, action sheets, toasts
- `src/mobile/components/` — Individual screens: MobileFoldersScreen, MobileNotesScreen, MobileEditorScreen, MobileSettingsScreen, MobileRecordingScreen, MobileRecentScreen. Plus MobileActionSheet, MobilePromptSheet, MobileTabBar, MobileNavBar, MobileToast.

## Gotchas

- **"Archieve" typo**: The archive folder is spelled "Archieve" in the codebase and in persisted data. Do not "fix" this — it would break existing user data.
- **MobileShell props**: MobileShell and MobileSettingsScreen still receive ~95 and ~66 props respectively from AppShell. They haven't been migrated to consume contexts directly yet.
- **Git sync uses libgit2**, not shell git. The Rust backend handles all git operations.
- **Editor saves are debounced** (400ms). `flushSave()` must be called before navigation away, session switching, or app backgrounding.
- **`shouldNestNotesInNavigation`**: When `notesListMode === "nested"`, notes appear inline inside the folder tree instead of in a separate middle pane. This affects keyboard navigation, rendering, and the visible navigation items computation.
