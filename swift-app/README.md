# Type — native iOS app

A native SwiftUI port of the mobile side of the Tauri notes app. It reads and
writes the **exact same on-disk format** (Markdown + YAML-ish front-matter, the
same folder layout) so the **same git repository** round-trips between the
desktop Tauri app and this iOS app.

This folder contains an Xcode project (`Type/Type.xcodeproj`) with two targets:

| Target | Folder | Role |
|--------|--------|------|
| `Type` | `Type/Type/` | the app |
| `Type Record WidgetExtension` | `Type/Type Record Widget/` | home-screen + lock-screen widgets, Live Activity |

> The project uses Xcode's **file-system–synchronized folder groups**
> (`objectVersion = 77`). That means **every `.swift` file inside a target's
> folder is compiled automatically** — to add a file you just drop it in the
> folder, no `.pbxproj` editing. Deployment target is **iOS 26.1**.

---

## Build status by stage

The brief is delivered in stages; each is its own commit.

- [x] **Stage 1 — Notes core.** On-disk format compatible with the desktop
      (front-matter parse/render, slug/filename rules, `Feed`/`Archieve` system
      folders, `.notes-order.json`), folders/feed navigation, a plain-text editor
      with debounced autosave + empty-note cleanup, and the **blank-page +
      swipe-up** compose flow. Includes the **workspace** (working-directory)
      abstraction designed to become multi-profile later.
- [ ] **Stage 2 — Git sync** compatible with the Tauri repo.
- [ ] **Stage 3 — Voice recording** + home-screen widget + lock-screen widget /
      Live Activity.
- [ ] **Stage 4 — Optional on-device transcription** (iPhone-native).
- [ ] **Stage 5 — Design docs** (no code): iCloud-instead-of-git, and
      encryption / lock screen / PIN / panic-mode.

These were developed in a Linux environment **without an iOS toolchain**, so the
code has not been compiled. It is written to be correct and idiomatic; treat the
first device build as the verification pass and expect small adjustments
(gesture thresholds, the newest-API edges called out below).

---

## Opening + first-run setup in Xcode

Open `Type/Type.xcodeproj`. Most of Stage 1 builds and runs as-is. The following
Xcode-side settings are needed (some only matter for later stages — noted):

### App target → Info (custom keys)

The app uses `GENERATE_INFOPLIST_FILE = YES`, so add these under the target's
**Info** tab (or an `INFOPLIST_KEY_…`/custom-plist as you prefer):

- **`CFBundleURLTypes`** → URL scheme **`type`** (for the widget deep link
  `type://record`). *Needed in Stage 3; harmless to add now.*
- **`NSMicrophoneUsageDescription`** = e.g. "Type records voice notes." *Stage 3.*
- **`NSSpeechRecognitionUsageDescription`** = e.g. "Type transcribes your
  recordings on-device." *Stage 4.*
- **`UIFileSharingEnabled` = YES** and
  **`LSSupportsOpeningDocumentsInPlace` = YES** — exposes the notes folder in the
  Files app so you can inspect/seed it. *Optional but recommended.*
- **`UIBackgroundModes`** → `audio` — lets recording continue from the lock
  screen. *Stage 3.*
- **`NSSupportsLiveActivities` = YES** — for the recording Live Activity.
  *Stage 3.*

### Capabilities (Signing & Capabilities)

- **App Groups** → add `group.com.digital.Type` to **both** the app and the
  widget targets. The shared container is how the widget/Live Activity and the
  app exchange recording state + files. *Stage 3.*
- **Background Modes → Audio** on the app target. *Stage 3.*

### Swift Package dependency (Stage 2 only)

Git sync uses **libgit2** via a Swift package. Add it through
*File ▸ Add Package Dependencies…* when you reach Stage 2 — the git code is gated
behind `#if canImport(...)` so the project builds fine before then. See the
Stage 2 notes (added with that commit) for the exact package + API.

---

## On-disk compatibility contract

This is the part that must never drift from the Rust backend
(`src-tauri/src/adapters/notes/`). The Swift implementations are direct ports and
cite their Rust source in comments.

### Folder layout (inside a notes root)

```
<root>/
  Feed/          default notes folder — never has a .notes-order.json (sorts by date)
  Archieve/      archive folder — the misspelling is INTENTIONAL and persisted
  Recordings/    audio storage (hidden from the tree)
  Attachments/   attachment storage (hidden from the tree)
  <user folders>/   ordered by .notes-order.json, alphabetical fallback
  .notes-order.json   { "folder_order": [...], "note_order": [...] }
```

Legacy migrations applied on launch: `Unsorted → Feed`, `_Recordings → Recordings`.

### Note file = front-matter + body

```
---
id: <uuidv7>
created_ms: <int>
updated_ms: <int>
type: <string?>                         # e.g. audio_recording
recording_audio_path: "Recordings/…"    # quoted because it contains '/'
transcription_status: <string?>         # pending|queued|processing|completed|failed
…
---

<body markdown>
```

Rules the codec enforces (see `Model/NoteDocument.swift`):

- Front-matter only if the file starts with `---\n` **and** contains `\n---\n`.
  CRLF is normalized to LF first.
- Field **order** on render is fixed (matches Rust). Integer fields are raw;
  string values are emitted raw when every char is `[A-Za-z0-9._-]`, otherwise
  wrapped with Rust `{:?}` debug-string quoting.
- Unknown keys are preserved verbatim as passthrough lines and re-emitted, so a
  newer desktop's fields are never dropped by iOS.
- The header is closed with `---\n\n`; the editor body has that one separator
  newline stripped on read and re-added on write, so round-trips are byte-stable.

### New-note filenames

Per-workspace strategy (default `utc_timestamp_slug`), matching the desktop:

- `utc_timestamp_slug`: `YYYY-MM-DDTHH-mm-ssZ-<slug>.md`
- `uuid_v7`: `<uuidv7>.md`
- `uuid_v7_prefix_slug`: `<uuidv7-prefix>-<slug>.md`

Slugging is Unicode-aware and strips editor noise tokens (port of
`slug_from_content`).

---

## Architecture (Stage 1)

```
Type/Type/
  TypeApp.swift            @main; AppState in environment; deep-link hook
  App/
    AppState.swift         @Observable coordinator: workspace, store, tree, draft
    RootView.swift         TabView: Write / Browse / Settings
  Model/
    NoteDocument.swift     front-matter parse/render (byte-compatible)
    NoteNaming.swift       slug + filename allocation + UUIDv7
    OrderFile.swift        .notes-order.json + sort-by-order
    FolderTree.swift       tree node + NotePreview
    Workspace.swift        working-directory model (future profiles)
  Storage/
    NotesStore.swift       filesystem engine (tree, CRUD, system folders, order)
    WorkspaceStore.swift   workspaces config + root URL resolution
  Features/
    Write/WriteView.swift          blank page + swipe-up
    Browse/BrowseView.swift        feed + folders
    Browse/FolderDetailView.swift  one folder
    Editor/NoteEditorView.swift    plain-text editor + autosave
    Settings/SettingsView.swift    workspace settings
  Support/
    Constants.swift        folder names, app group, url scheme, statuses
    Debouncer.swift        400 ms autosave debounce
```

### Workspaces (the “profiles later” seam)

A `Workspace` is just *a notes root + its own settings* (git remote, filename
strategy, transcription toggle). The config is a **list** with an active id,
stored in Application Support (never inside a synced notes root). Today there is
one default workspace (`Documents/Notes`); adding a switcher later needs no data
migration. This is the on-ramp for item 7 in the brief.

---

## Known Stage-1 simplifications (intentional, documented)

- **No at-rest encryption.** Bodies are plaintext. Compatible with a desktop that
  also has encryption off (the default). Encryption is a Stage-5 design doc.
- **No continuous auto-rename to slug.** A note's filename is chosen at creation
  from the initial content; it isn't renamed as you keep typing (the desktop does
  rename in some modes). Filenames are not semantically meaningful, so this stays
  fully compatible — it just means iOS-created notes may keep a `…-note.md`
  filename. Can be added later.
- **No drag-to-reorder / move between folders yet** (create, edit, delete,
  navigate are implemented).
- Feed previews are read on demand (no persisted preview cache yet).
