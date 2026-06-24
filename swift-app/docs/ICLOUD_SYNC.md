# iCloud sync instead of git — design (Stage 5, **not implemented**)

This is a reasoning document, not code. It describes what it would take to sync
notes over **iCloud** instead of (or alongside) git, and — crucially — what has
to change on **both** the iOS app and the Tauri **desktop** so the two keep
sharing one set of notes.

The north star is unchanged: **the `.md` files + folder layout stay the source
of truth.** Whatever sync transport we add must move those exact files, so a note
written on one device is the same bytes on the other (the same invariant git
gives us today).

---

## 1. Which iCloud, and why

There are two very different "iCloud" APIs:

| Option | What it is | Desktop interop | Verdict |
|--------|-----------|-----------------|---------|
| **iCloud Drive — ubiquitous container** | The notes root *is a folder in iCloud Drive*; the OS syncs the files. | macOS can read the same folder at `~/Library/Mobile Documents/…`. | ✅ **Recommended** — keeps the file model; desktop interop is "point a profile at that folder." |
| **CloudKit (`CKRecord`)** | Notes modeled as records in a private CloudKit DB. | No official Rust/desktop SDK; would need CloudKit Web Services. | ❌ Too big a departure; breaks the file-is-truth model and the desktop port. |

We pick **iCloud Drive (ubiquitous container)**. It is the only option that
preserves the on-disk contract and lets the existing desktop participate with
almost no new code, because the desktop already lets a profile's `notes_root` be
**any absolute path** (see `normalize_notes_root_path` in
`src-tauri/src/adapters/profiles/state.rs`).

### The honest limitation

iCloud Drive is **Apple-only**. So:

- **iOS ⇄ macOS desktop**: works over iCloud.
- **Windows / Linux desktop**: no iCloud Drive → those keep **git**.

So iCloud is an *additional, Apple-to-Apple* transport, **not** a replacement for
git. The right model is **per-profile sync backend**: a profile syncs over git
**or** iCloud, never both at once (see §4 on why mixing corrupts).

---

## 2. iOS side — what changes

### 2.1 Entitlements / capabilities

- **iCloud** capability → **iCloud Documents** on the app target.
- `com.apple.developer.icloud-container-identifiers` =
  `iCloud.com.digital.Type` (a new container).
- `com.apple.developer.ubiquity-container-identifiers` = same.
- `NSUbiquitousContainers` in Info to name/expose the container in the Files app
  (so users can see notes), e.g. `NSUbiquitousContainerIsDocumentScopePublic =
  true`, a friendly `NSUbiquitousContainerName`.

### 2.2 Root resolution (`WorkspaceStore`)

Today `WorkspaceStore.rootURL(for:)` resolves `relativeRoot` under the app's
local `Documents`. Add a **backend** to `Workspace`:

```
enum SyncBackend: String, Codable { case git, iCloud }   // design sketch
```

When `backend == .iCloud`, resolve the root inside the ubiquity container:

```
FileManager.default
  .url(forUbiquityContainerIdentifier: "iCloud.com.digital.Type")?
  .appendingPathComponent("Documents")
  .appendingPathComponent(relativeRoot)
```

`url(forUbiquityContainerIdentifier:)` **blocks and may return nil** the first
time (account not ready / signed out). So this must be called **off the main
thread**, with a fallback + user-visible "iCloud not available" state — not the
synchronous local-Documents path we use now.

### 2.3 Reads/writes must be file-coordinated

The app currently writes atomically (`Data.write(options:.atomic)`) and reads
directly. Under iCloud that races the sync daemon. Every read/write of a note,
`.notes-order.json`, or system folder must go through **`NSFileCoordinator`**:

- write: `coordinate(writingItemAt:options:.forReplacing)`.
- read: `coordinate(readingItemAt:options:[])`.

Concretely: `NotesStore` gains a coordinated I/O seam (the same methods, wrapped)
used only when the active workspace is iCloud-backed. Local/git workspaces keep
the cheap direct path.

### 2.4 Not-yet-downloaded placeholders

iCloud may present a file as a `*.icloud` placeholder that isn't downloaded yet.
The tree builder (`buildNode`) must:

- recognize placeholders (`URLResourceValues.ubiquitousItemDownloadingStatus`,
  or the `.icloud` extension) and **not** treat them as missing,
- trigger `FileManager.startDownloadingUbiquitousItem(at:)` before reading a
  body,
- show a "downloading" state in the row instead of an empty note.

### 2.5 Observing remote changes

Replace "refresh after my own writes" with **`NSMetadataQuery`** over
`NSMetadataQueryUbiquitousDocumentsScope`:

- start a query for the container, observe `.NSMetadataQueryDidUpdate`,
- on update → `AppState.refreshTree()` (and invalidate previews),
- this is the iCloud equivalent of "a git pull brought new commits."

### 2.6 Conflicts → mirror the git `.conflict.md` rule

iCloud surfaces conflicts as **`NSFileVersion.unresolvedConflictVersionsOfItem`**.
To keep behavior identical to the git path (AGENTS.md "Merge conflict
resolution": keep ours, write theirs as a `.conflict.md` sibling):

- on a conflicted note, keep the current file as-is,
- write each losing version to `note.conflict.md`,
- mark all versions resolved (`NSFileVersion.isResolved = true` +
  `removeOtherVersionsOfItem`).

This means a user sees the same "resolve the `.conflict.md`" UX no matter which
backend a profile uses, and the desktop's existing conflict handling still
applies.

### 2.7 Settings / model

- `SettingsView` (and the future profile switcher) gains a **Sync backend**
  picker: *Git* / *iCloud*. Choosing iCloud hides the git remote/credentials
  fields and shows iCloud account status.
- The git pieces stay exactly as they are (Stage 2) — iCloud is parallel.

---

## 3. Tauri desktop side — what changes

The desktop already supports an arbitrary absolute `notes_root`, so the **data
path needs almost nothing**. The work is making macOS treat that folder as live:

### 3.1 macOS: allow/encourage the iCloud Drive path

- A profile's `notes_root` can be set to
  `~/Library/Mobile Documents/iCloud~com~digital~Type/Documents/<relativeRoot>`.
  `normalize_notes_root_path` already accepts absolute paths; just document this
  and add a one-click "Use iCloud Drive folder" in desktop Settings ▸ Profile
  that fills it in.
- **No git for that profile.** The desktop's per-profile sync settings must allow
  a profile with **no git remote** (sync = "handled by iCloud / the OS"). Today
  sync assumes git; add a `sync_backend` field to the profile (mirror of the iOS
  `SyncBackend`) so the desktop knows not to offer commit/pull/push and not to
  create a `.git` dir there.

### 3.2 External-change watching

Git sync refreshes the tree on pull. With iCloud, the macOS file provider mutates
files underneath the app. The desktop should watch the root (e.g. `notify`/
FSEvents) and re-emit the tree when iCloud writes land — the same refresh the iOS
`NSMetadataQuery` triggers. If a watcher already exists for local edits, point it
at the iCloud folder; otherwise this is the one genuinely new desktop component.

### 3.3 Windows / Linux

No change — those platforms can't join an iCloud profile. A profile is either
*git* (cross-platform) or *iCloud* (Apple-only). The UI should gray out "iCloud"
where unsupported.

### 3.4 Conflict parity

The desktop already understands `*.conflict.md` siblings (it's the git merge
output). Since the iOS iCloud path writes the **same** sibling shape (§2.6), the
desktop needs no new conflict logic — it just sees `.conflict.md` files appear.

---

## 4. Why you cannot mix git **and** iCloud on one root

If a root is both a git working tree **and** an iCloud container, iCloud will sync
the `.git` directory **partially and out of order** (it's thousands of small
objects). A half-synced `.git` is a corrupted repo. So:

- A profile is **exclusively** git **or** iCloud.
- iCloud profiles must **not** contain a `.git` dir.
- Switching backends is a migration (copy the notes tree into the other location,
  then drop or create `.git`), done once, with the editor flushed first — not a
  per-sync toggle.

(If we ever *had* to colocate, we'd need iCloud to ignore `.git`, which the
ubiquitous-container API can't reliably guarantee — hence the hard split.)

---

## 5. What explicitly does **not** change

- **On-disk format** — front-matter, body, filenames, `Feed`/`Archieve`,
  `.notes-order.json`, hidden `Recordings/`: untouched. That's the whole point.
- **Recording / transcription** — they write the same note shape; iCloud just
  moves the files.
- **Encryption** (see `ENCRYPTION.md`) — composes cleanly: encrypted bodies are
  still plain `.md` files, so iCloud syncs ciphertext exactly like git does. (The
  key salt caveat in `ENCRYPTION.md` §"Cross-device" applies identically.)

---

## 6. Rollout sketch (if/when implemented)

1. Add `SyncBackend` to the iOS `Workspace` + desktop profile; default `.git`
   (no behavior change for anyone).
2. iOS: ubiquity-container root resolution + coordinated I/O + `NSMetadataQuery`
   refresh + placeholder download + `.conflict.md` from `NSFileVersion`.
3. Desktop (macOS): "Use iCloud Drive folder" action + a no-git sync mode + a
   folder watcher.
4. Settings: backend picker on both, gated by platform.
5. Migration command: git-root → iCloud-root copy (flush editor, drop `.git`).

Everything above is **design only**; no code in this stage.
