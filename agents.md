# Architecture

## Provider tree

```
ThemeProvider           — theme, notesListMode, editorFontSize
  SessionsProvider      — sessions, sync settings, session switching
    GitSyncProvider     — git status, connect/pull/push, history
      NotesTreeProvider — folder tree, selection, editor, CRUD
        RecordingsProvider — audio recording, transcription, playback
          AppShell      — DnD, keyboard nav, rendering
```

`App.tsx` composes the providers. `AppShell.tsx` consumes all contexts and owns local UI state (appMode, sidebar, pane layouts).

## Directory structure

```
src/
├── contexts/                    # React contexts (shared state)
│   ├── ThemeContext.tsx          # Theme, notes list mode, font size
│   ├── SessionsContext.tsx      # Sessions, per-session sync settings
│   ├── GitSyncContext.tsx       # Git status, sync operations, history
│   ├── NotesTreeContext.tsx     # Folder tree, selection, editor, CRUD
│   └── RecordingsContext.tsx    # Audio recording, transcription, playback
├── hooks/                       # Custom React hooks
│   ├── useDragDrop.ts           # Folder/note drag-and-drop (DnD Kit)
│   ├── useKeyboardNavigation.ts # Global shortcuts + arrow-key navigation
│   ├── useNoteEditor.ts         # Autosave, dirty tracking, flush-on-switch
│   ├── useNotePreviews.ts       # Note list preview generation
│   └── useAudioRecorder.ts      # Web MediaRecorder + native iOS recording
├── data/                        # Data access layer (Tauri IPC)
│   └── notesApi.ts              # All backend communication
├── utils/
│   ├── treeOps.ts               # Tree manipulation (build, flatten, drag ops)
│   ├── dom.ts                   # Focus, scroll, selector helpers
│   ├── format.ts                # Date labels, note preview parsing
│   ├── storage.ts               # localStorage helpers (theme, sync, history)
│   └── notes.ts                 # getNoteParentPath, collectAllNotes, base64
├── components/
│   ├── FoldersPanel.tsx          # Folder tree sidebar
│   ├── NoteEditor.tsx            # Tiptap markdown editor
│   ├── NoteRow.tsx               # Single note list item (sortable)
│   ├── SettingsPanel.tsx         # Settings sections list + detail views
│   ├── SortableTreeItem.tsx      # Draggable folder tree item
│   ├── ErrorBoundary.tsx         # Error boundary with reset
│   └── ui/                       # Shadcn/ui primitives
├── desktop/
│   └── DesktopShell.tsx          # Resizable three-pane desktop layout
├── mobile/
│   ├── MobileShell.tsx           # Phone/tablet navigation shell
│   ├── navigation.ts            # Route types + reducer
│   ├── useLayoutMode.ts         # Breakpoint detection
│   ├── useKeyboardInsets.ts     # VisualViewport keyboard inset handling
│   └── components/              # Mobile screens, nav, action sheets
├── tree/
│   ├── types.ts                  # TreeItem, FlattenedItem
│   └── utilities.ts              # Core tree operations
├── App.tsx                       # Provider tree (~64 lines)
├── AppShell.tsx                  # Main UI composition (~890 lines)
├── constants.ts                  # Shared constants
└── types.ts                      # Shared types
```

## Contexts

| Context | State | Key actions |
|---------|-------|-------------|
| `ThemeContext` | theme, notesListMode, editorFontSize | setters, font size increase/decrease/reset |
| `SessionsContext` | sessionsSnapshot, syncSettings | refreshSessions, switchSession, createSession, updateSyncSettings |
| `GitSyncContext` | gitStatus, gitSyncAction, gitSyncHistory | refreshGitStatus, connectGitRepo, gitPull, gitPush |
| `RecordingsContext` | recording status, queue, list, audio playback | startRecording, stopRecording, refreshRecordings, playRecording, queueRecordingTranscriptions |
| `NotesTreeContext` | tree, expanded, selectedFolders/Notes, activeFolder/Note, editor state | refreshTree, createNewNote, deleteNotes, deleteFolders, moveNotesToArchive, rename, mobile selection helpers |

## Cross-context bridges

- **FlushSaveBridge**: Connects `NotesTreeContext.flushSave` to `SessionsProvider.flushSaveRef` so session switching can flush the editor.
- **RecordingsProvider.onRecordingComplete**: Callback wired in `App.tsx` that refreshes the tree and selects the new recording's note after capture.
- **GitSyncContext.gitPull.onAfterPull**: Optional callback to refresh tree after a successful pull.

## Data layer (`src/data/notesApi.ts`)

All backend communication goes through this module. Every function maps to a single Tauri IPC command.

| Function | Command | Description |
|----------|---------|-------------|
| `getTree()` | `get_tree` | Fetch full folder/note tree |
| `readNote(path)` | `read_note` | Read note markdown content |
| `writeNote(path, content)` | `write_note` | Save note content |
| `getNoteMeta(path)` | `get_note_meta` | Get created/updated timestamps |
| `deleteItems(items)` | `delete_items` | Delete files/folders |
| `moveItems(items, dest)` | `move_items` | Move to different folder |
| `renameItem(path, name)` | `rename_item` | Rename file/folder |
| `setOrder(args)` | `set_order` | Persist folder/note ordering |
| `getGitStatus()` | `git_status` | Git repo status |
| `connectGitRepo(...)` | `git_connect` | Initialize/connect remote |
| `gitPull(...)` | `git_pull` | Pull from remote |
| `gitPush(...)` | `git_push` | Commit + push to remote |
| `getSessions()` | `get_sessions` | List sessions |
| `setActiveSession(id)` | `set_active_session` | Switch session |
| `createSession(name)` | `create_session` | Create new session |
| `listRecordings()` | `list_recordings` | List recordings + queue state |
| `saveAudioRecording(...)` | `save_audio_recording` | Save captured audio |
| `queueRecordingTranscriptions(key)` | `queue_recording_transcriptions` | Queue pending transcriptions |

## Data flow

```
User Action → AppShell handler → context action → api.* call → Tauri backend → filesystem
                                        ↓
                                  refreshTree() → setTree() → re-render
```

Notes auto-save via `useNoteEditor`: content changes trigger a 400ms debounced `writeNote`.

## Layout modes

| Mode | Breakpoint | Shell |
|------|-----------|-------|
| phone | < 768px | MobileShell (stack nav) |
| tablet | 768–1024px | MobileShell (split view) |
| desktop | > 1024px | DesktopShell (resizable panes) |

## Build

```bash
npm run build                                    # tsc + vite
cargo check --manifest-path src-tauri/Cargo.toml # rust backend
```

## Git sync

Uses `libgit2` via Tauri commands — no shell `git` needed. Credentials stored in localStorage per-session. Pull requires clean working state; diverged history blocks pull with an error.

Synced content: markdown files, recording audio/transcripts, `.notes-order.json` files, folder structure.

## Security

- Git tokens in localStorage — use least-privilege tokens, rotate as needed
- Sensitive fields redacted from frontend invoke logs
