# Git sync (Stage 2)

The iOS app syncs the notes folder to the **same git repository** the desktop
Tauri app uses. Git is git, so as long as both sides commit the same files to the
same branch/remote, they interoperate. The desktop and iOS both use **libgit2**.

## How it's wired

- `Sync/GitSyncing.swift` — the `GitClient` protocol + value types + a
  `UnavailableGitClient` fallback + `GitClientFactory`.
- `Sync/LibGit2Client.swift` — the real implementation against the libgit2 **C
  API**, entirely behind `#if canImport(Clibgit2)`.
- `Sync/GitSyncCoordinator.swift` — the observable orchestrator that runs the
  full flow off the main actor.
- `Sync/GitCredentialStore.swift` — the token in the iOS Keychain.
- `Features/Settings/SyncSettingsView.swift` — the UI (Settings ▸ Git sync).

Because everything is gated, **the app builds and runs (local-only) without any
git package**. The sync UI shows a "not compiled in" hint until you add one.

## Adding the libgit2 package

In Xcode: *File ▸ Add Package Dependencies…* and add a libgit2 distribution that
vends the C module as **`Clibgit2`**. Options:

- **SwiftGit2** (`https://github.com/SwiftGit2/SwiftGit2`) — bundles libgit2 and
  exposes the underlying `Clibgit2` system module. Add the `Clibgit2` (or
  `SwiftGit2`, which re-exports it) product to the **app** target.
- A standalone prebuilt **`libgit2.xcframework`** wrapped in a small SPM package
  whose module map names the module `Clibgit2`.

If your chosen package names the C module something other than `Clibgit2`, change
the two lines `#if canImport(Clibgit2)` / `import Clibgit2` at the top of
`LibGit2Client.swift` (and the `canImport` check in `GitSyncing.swift`).

> HTTPS works out of the box. **SSH** (`git@…`) additionally needs libssh2
> compiled into the libgit2 build; not all xcframeworks include it. Prefer an
> HTTPS remote on iOS.

## Authentication

Configured per workspace in Settings ▸ Git sync:

- **Remote URL** — e.g. `https://github.com/you/notes.git`.
- **Username** + **Token** — for GitHub/GitLab/etc. use a **Personal Access
  Token** as the password (repo scope). The token is stored in the **Keychain**
  (`GitCredentialStore`), not in the workspace JSON.
- **Branch** — optional; empty uses the checked-out branch, else `main`.
- **Commit identity** — name/email for commits (defaults to `Type (iOS)`).

The libgit2 credentials callback currently answers `USERPASS_PLAINTEXT`
(username+token). SSH key auth is stubbed as a future enhancement.

## The sync flow

`GitSyncCoordinator.sync` runs, all off the main actor:

1. `ensureRepository` — open or `git init` the notes root; set `origin`.
2. `prepareBranch` — on a fresh repo, point HEAD at the target branch.
3. `commitAll` — stage everything (adds, mods, deletes) and commit; no-op if the
   tree is unchanged.
4. `pull` — fetch `origin`, then:
   - **up to date** → nothing,
   - **fast-forward** → check out the remote tree + move the branch,
   - **diverged** → merge. Conflicts are resolved by **keeping ours** in the
     working tree and writing **theirs** to a `<name>.conflict.md` sibling, then
     committing the merge. This matches the desktop exactly, so a pull is never
     blocked. Resolve by editing and deleting the `.conflict.md` file.
5. `push` — push the branch to `origin`.

## What syncs

Everything in the notes root: note `.md` files, `.notes-order.json`, and the
`Recordings/`/`Attachments/` folders (so audio syncs too). The workspace config
lives in Application Support, **outside** the root, so it never syncs.

## ⚠️ Verify on device first

`LibGit2Client.swift` was written against the stable libgit2 C API but **not
compiled here**. On the first device build, check these known package-dependent
spots:

1. **Module name** — `import Clibgit2` must match your package's C module.
2. **`git_credential_*` vs `git_cred_*`** — libgit2 1.x uses `git_credential_*`
   (used here). Older builds use `git_cred_*`; rename if needed.
3. **Enum `.rawValue` spellings** — `GIT_MERGE_ANALYSIS_*`, `GIT_CHECKOUT_*`,
   `GIT_CREDENTIAL_USERPASS_PLAINTEXT`, `GIT_ITEROVER`, `GIT_OBJECT_COMMIT`. These
   import as `RawRepresentable` from libgit2 1.x; if your headers import them as
   bare `Int32` constants, drop the `.rawValue`.
4. **First push to an empty remote** — create the repo on the host first (or push
   succeeds creating the branch). Test record-on-phone → sync → see it on desktop,
   and edit-on-desktop → sync → see it on phone.

Suggested first test: a throwaway private repo, HTTPS + PAT, one note created on
each side, then sync both ways.
