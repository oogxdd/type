# Mobile external working folders

Status: design note, not an implemented feature.

Mobile currently keeps its canonical working folders inside Type's app
container. The explicit ZIP and recursive-copy backup flows are the safe bridge
to Files / Android document providers. Making a user-selected directory the
*live* working folder is a separate filesystem architecture project.

## Why the two platforms differ

### iOS

`UIDocumentPickerViewController` can grant a security-scoped URL for a selected
directory. The app can persist a security-scoped bookmark and resolve it after
restart. A shell-owned access lease must remain open for every Rust operation;
passing the path into `AppEnv` and immediately calling
`stopAccessingSecurityScopedResource()` is not sufficient.

Even with a URL, non-local File Provider directories need coordinated writes,
can contain files that are not downloaded, and may revoke or stale the bookmark.
Git repositories add more assumptions about atomic renames, locks, dotfiles,
permissions, and random I/O that providers do not all satisfy.

### Android

Storage Access Framework directory selection returns a `content://` tree URI,
not a POSIX filesystem path. Access is through `ContentResolver` /
`DocumentsContract`. The current core and libgit2 both operate on `PathBuf` and
cannot safely receive that URI as `notes_root`.

Replacing the notes filesystem adapter with a document-provider adapter would
cover basic note I/O, but libgit2 would still require a real working tree.
Provider behavior around hidden `.git` files, atomic replacement, rename,
locking, and performance also varies.

## Recommended direction

Keep internal app storage as the canonical working tree until the storage port
can express capabilities beyond an absolute path. Continue offering explicit
backup/export and import/restore first; these have clear transactional
boundaries and work across providers.

If live external folders become a priority:

1. Introduce a device-local `WorkingFolderLocation` handle instead of storing
   only `notes_root`:
   - internal filesystem path;
   - iOS security-scoped bookmark;
   - Android persisted SAF tree URI.
2. Keep handles device-local (never in synced `.type/settings.json`).
3. Add storage capabilities such as atomic replace, recursive enumeration,
   hidden-file support, stable file identity, and native-path availability.
4. Gate Git support on native-path semantics. A SAF-backed notes folder may
   need a managed internal Git mirror rather than running libgit2 in the
   provider tree.
5. Make migration transactional:
   - acquire and persist permission;
   - validate read/write and provider capabilities;
   - copy into a uniquely named staging directory;
   - verify every file count, byte count, and preferably hash;
   - atomically switch the profile only after verification;
   - retain the old folder until the user confirms the result.
6. Surface revoked/stale/offline-provider states as recoverable UI, never as an
   empty working folder.

## Verification matrix

At minimum, test On My iPhone, iCloud Drive, local Android Documents/Downloads,
Google Drive, and one third-party provider. For each, cover:

- device lock and background/resume during I/O;
- offline or evicted cloud files;
- permission revocation and stale iOS bookmarks;
- low disk space and partially completed migration;
- hidden `.type` and `.git` trees;
- recordings large enough to expose memory/copy problems;
- app update, process termination, reboot, and reinstall;
- case-only renames, Unicode names, and provider filename restrictions.

The main product decision is whether cross-platform sameness matters more than
allowing a narrower iOS-only live-folder path early. Keeping the internal folder
canonical plus explicit verified backups is the more predictable choice while
the app and on-disk format are still changing quickly.
