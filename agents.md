# Project Architecture

Apple Notes Viewer — a Tauri + React desktop app for browsing and editing markdown notes stored on the local filesystem.

## Directory Structure

```
src/
├── data/                    # Data access layer (Tauri IPC)
│   └── notesApi.ts          # All backend communication
├── hooks/                   # Custom React hooks
│   ├── useNoteEditor.ts     # Note content, autosave, dirty state
│   └── useNotePreviews.ts   # Note list preview generation
├── utils/                   # Pure utility functions
│   ├── treeOps.ts           # Tree manipulation (build, flatten, drag ops)
│   ├── dom.ts               # Focus, scroll, selector helpers
│   └── format.ts            # Date labels, note preview parsing
├── components/              # React components
│   ├── FoldersPanel.tsx     # Folder tree sidebar with tabs
│   ├── NoteEditor.tsx       # Tiptap markdown editor
│   ├── NoteRow.tsx          # Single note list item (sortable)
│   ├── SettingsPanel.tsx    # Settings sections list + detail views
│   ├── SortableTreeItem.tsx # Draggable folder tree item
│   └── ui/                  # Shadcn/ui primitives
├── tree/                    # Tree data structures
│   ├── types.ts             # TreeItem, FlattenedItem
│   └── utilities.ts         # Core tree operations
├── App.tsx                  # Orchestration: state, drag-drop, keyboard, layout
├── App.css                  # Application styles
├── types.ts                 # Shared types (FolderNode, NoteEntry, etc.)
└── main.tsx                 # React entry point
```

## Data Layer (`src/data/notesApi.ts`)

All backend communication goes through this module. Every function maps to a single Tauri IPC command. The module handles logging automatically.

**To swap the data layer** (e.g. for a web API, local-first DB, or mock):
1. Create a new file implementing the same exports (`getTree`, `readNote`, `writeNote`, etc.)
2. Change the single import in `App.tsx`: `import * as api from "./data/newApi"`
3. Hooks (`useNoteEditor`, `useNotePreviews`) import directly from `data/notesApi` — update those imports too

| Function | Tauri Command | Description |
|----------|--------------|-------------|
| `getTree()` | `get_tree` | Fetch full folder/note tree |
| `readNote(path)` | `read_note` | Read note markdown content |
| `writeNote(path, content)` | `write_note` | Save note content |
| `getNoteMeta(path)` | `get_note_meta` | Get created/updated timestamps |
| `deleteItems(items)` | `delete_items` | Delete files/folders |
| `moveItems(items, dest)` | `move_items` | Move to different folder |
| `renameItem(path, name)` | `rename_item` | Rename file/folder |
| `setOrder(args)` | `set_order` | Persist folder/note ordering |

## Hooks

### `useNoteEditor(activeNote)`
Manages the editor's content lifecycle: loads note content when `activeNote` changes, debounces autosave (400ms), tracks dirty state. Returns `{ noteContent, draftNoteContent, handleEditorChange, clearNote }`.

### `useNotePreviews(notes)`
Given an array of `NoteEntry`, fetches each note's meta + content in parallel and generates preview objects (title, date label, second line). Returns `Record<string, NotePreview>`.

## App.tsx — Orchestration

App.tsx is the orchestration layer. It owns:
- **UI layout state**: theme, sidebar, panel sizes, font size, app mode
- **Selection state**: selected/active folders and notes
- **Folder tree**: loads via `api.getTree()`, builds computed tree data
- **Drag & drop**: all DnD Kit handlers for reordering folders/notes
- **Keyboard shortcuts**: Cmd+T (toggle sidebar), Cmd+W (switch panes), Cmd+J/K (navigate panes), Cmd+N (new note), Cmd+=/- (zoom)
- **Context menus**: native Tauri menus for folder/note right-click actions

## Key Data Flow

```
User Action → App.tsx handler → api.* call → Tauri backend → filesystem
                                    ↓
                              refreshTree() → setTree() → re-render
```

Notes are auto-saved via `useNoteEditor`: content changes trigger a 400ms debounced `writeNote`.

## Types (`src/types.ts`)

- `FolderNode` — recursive tree from backend: `{ name, path, children, notes }`
- `NoteEntry` — `{ name, path }`
- `NoteMeta` — `{ created_ms, updated_ms }`
- `DragData` — `{ type: "folder" | "note", path }`
