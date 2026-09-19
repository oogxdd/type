# Removing legacy recording audio from Git history

New recordings for an Iroh working folder travel outside Git. Failed pairing
leaves audio on the phone for retry; it never enables a Git fallback. Ordinary
Git-only connections still carry audio in Git because they have no independent
attachment transport. Existing tracked audio remains tracked until migration.

The seven-day mobile policy removes only untracked recordings with completed
transcription and a matching desktop durability receipt. Seven days is a minimum
age, not a background deletion deadline. Retention runs while the app is active.

## Prepare a separate verified copy

`scripts/prepare-audio-history-migration.py` rewrites only a new copy of a notes
root. It does not modify the source, activate the copy, contact a remote, or
force-push. Use the desktop's full notes root, not the application data directory.

1. Install the updated phone and desktop code first.
2. Sync all devices successfully, including outstanding audio uploads. Keep any
   unsynced device backed up; the tool cannot inspect a disconnected phone.
3. Quit Type on all devices, including its desktop sync server. Keep it stopped
   while preparing and switching histories.
4. Use a Python environment with `git-filter-repo==2.47.0` installed:

   ```sh
   python3 -m venv /tmp/type-audio-migration
   /tmp/type-audio-migration/bin/pip install git-filter-repo==2.47.0
   /tmp/type-audio-migration/bin/python scripts/prepare-audio-history-migration.py \
     /absolute/path/to/notes /absolute/path/to/migration-output --apps-stopped
   ```

The destination must not exist and must be outside the source tree. Allow room
for two full copies initially. Linked worktrees, shallow repos, shared object
stores, symlinks, unfinished merges/rebases, and replace refs are rejected.

The output contains:

- `original/`: a verified complete backup, including current edits, ignored
  files, audio, Git config, and the original Git object database.
- `migrated/`: current files plus the rewritten Git database. `Recordings/` and
  legacy `_Recordings/` are removed from every historical tree, but their current
  files remain on disk. Those storage directories include transcription sidecars;
  note bodies and transcripts stored in Markdown remain in history.
- `report.json`: produced only after verification succeeds, with commit counts
  and before/after Git sizes. The old-to-new commit map is under
  `migrated/.git/filter-repo/commit-map`.

Every reachable commit is preserved, including audio-only commits that become
empty. The tool checks non-audio paths, file modes, content object IDs, authors,
committers, timestamps, messages, and parent relationships for every commit.
Branches and tags point to corresponding rewritten commits. Remote-only history
and stashes are retained as local `type-migration/...` recovery branches. Commit
IDs necessarily change; cryptographic signatures cannot survive a rewrite.
Unreachable/reflog-only history remains in `original/`, not the cleaned database.

Current uncommitted edits and untracked files are copied byte-for-byte. The new
index reflects HEAD, so staged edits become ordinary working-tree edits. Git
remotes and device-local sync connection fields are cleared in the prepared copy
to prevent accidentally reconnecting it to the old history. Other current files
are verified against the backup. A failed verification leaves the output for
inspection, produces no success report, and never activates anything.

Filtering uses [git-filter-repo](https://github.com/newren/git-filter-repo), with
empty-commit pruning and commit-message hash replacement disabled.

## Resume this user's migration (handoff, 2026-09-16)

The user chose to **keep the existing desktop notes folder**, replace only its
Git database with the filtered history, and initialize a fresh phone working
folder. Preserve the complete text history; do not squash it or start an orphan
branch. Preparation is authorized and has been performed. **Activation has not
happened.** This guide documents the pending procedure; it is not evidence that
the user has completed the phone sync or stopped the apps.

Known paths on the user's Mac:

- Repository checkout: `/Volumes/KINGSTON/Projects/type/app`.
- Live desktop notes root:
  `/Users/digital/Library/Application Support/com.digital.type2/profiles/123fresh/notes`.
- Its actual Git database: the hidden `.git` directory inside that notes root.
- Previously prepared output:
  `/Users/digital/Downloads/Type-audio-migration-123fresh-20260916-224416`.
  Contains `original/`, `migrated/`, and `report.json`.

That preparation used an independently verified temporary snapshot while Type
was running. The live source remained unchanged during preparation. The report
verified 201 commits and reduced Git storage from 85,915,257 to 6,903,179 bytes.
It preserved the audio files and two existing uncommitted note deletions. Those
deletions are user state: do not restore them just to make Git status clean.

**Treat the old prepared output as a preview/backup, not as the next database to
install.** The user may have edited or synced since it was created. Regenerate
from the final, stopped desktop state before activation.

Code status:

- `6ea08837` fixed overlapping mobile sync workflows and moved audio cache
  maintenance after notes push.
- The commit adding this handoff also includes fetch/authentication before local
  commits, reuse of the authenticated push connection, persistent Iroh audio
  exclusion on pairing failures and manual checkpoints, batched receipt reads,
  stage timings, and the migration script/tests.
- Installation of these changes on the actual desktop and phone has **not been
  verified**. Rust core changes require native builds; a JavaScript-only OTA
  update is insufficient. See [mobile build instructions](../apps/mobile/README.md)
  and [release instructions](RELEASING.md). Determine the user's installed build
  variant before rebuilding; do not uninstall an app holding unsynced notes.
- Never run a development desktop build against production notes to test this.
  Follow the isolated-development identifier rule in `AGENTS.md`.

Temporary tools used during preparation were installed under
`/private/tmp/type-sync-migration-tools`; do not assume they still exist. The
wrapper `/private/tmp/type-prepare-123fresh.py` was a one-off snapshot helper,
not the supported activation procedure. Use the repository script above.

## Recommended activation: keep the existing desktop path

Do these steps in order. A fresh agent can prepare builds, inspect repository
state, and prepare copies autonomously, but must obtain actual device-state
information for steps 2–3. Silence or elapsed time does not prove a phone synced
or an app stopped. Do not switch the live history while these facts are unknown.

1. **Install the fixes on both devices.** Preserve the installed apps' data.
   Confirm the binaries contain the Rust changes as well as the frontend changes.
2. **Finish the last sync using the old history.** Open the existing phone working
   folder, sync, and wait for both notes and audio uploads. A notes-only `Synced`
   label does not prove audio arrived. Check the desktop contains the latest
   notes and recordings, and resolve any failed/pending uploads. Account for
   every additional device or Git remote; unsynced work must be saved before
   abandoning an old clone. If an offline device cannot sync, back it up and
   recover its current files separately rather than merging its old Git history.
3. **Stop all peers.** On macOS quit Type with Cmd+Q; closing its window leaves
   the sync server running. Close Type on the phone and other peers. Verify the
   desktop process/server stopped and no Git operation is active. Do not kill
   a process mid-save or assume a hidden window means it exited.
4. **Prepare a fresh verified copy.** Run the command above against the live
   notes root with a new, separate output directory. Only now use
   `--apps-stopped`. Require `report.json` with `verified: true`. Preserve
   `original/` as a full backup, including `.type/device.json`, current files,
   ignored audio, and the old `.git`. Compare the live source with `original/`
   again immediately before replacement; abort and regenerate if it changed.
5. **Replace only the live `.git`, with Type still stopped.** Copy
   `migrated/.git` into a new staging directory on the same filesystem as the
   live root. Verify the copy. Move the old live `.git` to a uniquely named
   backup **outside the notes root**, then rename the staged Git directory to
   the live `.git` path. Do not delete the old database; if the second rename
   fails, immediately move the old one back before doing anything else.
   Do not overwrite the live Markdown files, `Recordings/`, `.type/`, or other
   working-tree files with those from the prepared copy.
6. **Validate before reopening.** Run `git fsck --full --strict`, confirm the
   new HEAD/refs match the prepared copy, ensure `git ls-files -- Recordings
   _Recordings` is empty, and check the expected current edits/deletions remain.
   Verify `/Recordings/` and `/_Recordings/` are in `.git/info/exclude`. Hash
   current notes/audio against the backup to confirm the Git swap changed no
   working-tree content.

   The in-place swap retains the live `.type/device.json`, whereas the prepared
   copy has its sync connection fields cleared. Inspect the live saved Git
   connection **without printing passwords or pairing tokens**. If it points to
   an old upstream, clear only its connection fields (as in the preparation
   script) after backing it up, or otherwise disable that old connection before
   opening Type. Preserve unrelated settings. Do not let automatic reconnect
   fetch the old history. External upstreams need their own coordinated migration;
   this procedure does not authorize blindly force-pushing to them.
7. **Restart the desktop and its sync server.** Keep the same desktop working
   folder and notes-root path. Generate/show its current pairing QR. Keep all
   old phone working folders closed and inactive. Existing authorized device
   keys may still work: a new QR by itself does not prevent an old clone syncing.
8. **Create a new empty phone working folder.** Do this before triggering sync
   from the old folder. Pair the new folder using the current desktop QR and pull
   the cleaned history. Do not merely rescan the QR into the old phone folder;
   it still holds the old commits. If opening the phone app would auto-sync the
   old folder, first open it with networking disabled, select/create the new
   empty folder, then restore networking and pair.
9. **Verify before removing anything.** Check recent notes and transcripts on
   both devices, and play representative recordings on the desktop. Create a
   small test note on each device and sync both ways. Confirm no old-history
   branch/audio objects reappeared. The new phone folder may show recordings as
   archived on the desktop; old phone-local audio cache files are not copied
   into it automatically.
10. **Keep old clones inactive; cleanup is not yet a mobile UI feature.**
    The mobile Working Folders screen supports creation and selection, but has
    no delete action. The core `delete_profile_state` removes the profile entry
    only; it does not delete its notes root or Git database. Do not claim this
    frees storage. A separate verified cleanup implementation or a full app-data
    reset is required to reclaim the old phone repository. Keep the full desktop
    backup until every device has migrated and the user is satisfied.

### Verified phone UI and alternatives (2026-09-17)

The current route is **Settings → Working Folders → New working folder → name →
Create**. Creation automatically selects the new profile, whose sync settings
are initially empty. Then open **Sync → Scan QR code**, pair, and run **Sync now**.
Do not switch profiles during an active sync. Prefer creating/selecting the fresh
phone folder immediately after the last successful old-history sync and before
replacing the desktop `.git`; this avoids foreground auto-sync from the old
profile after the swap. Close the apps afterward and continue the desktop steps.

The core regression test
`new_phone_profile_connects_to_existing_history_without_old_commits` covers actual
profile creation, selection, exclusion setup, connection and pull from a local
Git peer, and absence of old-profile commits in the new repository. This is not
an on-device camera/SSH/Iroh end-to-end test or verification of the installed app.

A fresh working folder is not the only possible migration:

- Reinitializing only the phone's `.git` while preserving its profile and files
  could provide a simpler user flow, but no such command/UI exists today. It
  needs a guarded reset/reclone implementation and unsynced-data safeguards.
- Removing and reinstalling the phone app (not offloading it on iOS) can give a
  fresh app container and reclaim old history, but removes all local working
  folders, settings and keys. Consider it only after verified backups and full
  desktop receipt of every device's data; do not recommend it as harmless cleanup.
- Retaining the old history needs no migration at all. The fixes prevent new
  Iroh audio from entering Git; old blobs remain. This is reasonable if reclaiming
  the measured roughly 79 MB is not worth the one-time device migration.

If activation fails before new edits exist, stop every peer and restore the old
Git database and any changed device-local connection settings from the backup.
After new edits exist, back them up first; do not blindly roll back or merge old
and new histories. Preserve current note files and resolve recovery deliberately.

### Alternative: use the prepared folder as a new desktop working folder

If the user later prefers a new desktop path, activate the freshly prepared
`migrated/` directory as a new working folder instead of replacing `.git` in place.
The same last-sync, stopped-app, fresh-phone-folder, and verification requirements
apply. Keep the original desktop folder inactive. This is an alternative, not the
currently selected plan.

## Storage and verification limits

Do not pull or merge an old phone repository into the rewritten desktop history:
that would reintroduce the removed audio blobs. A plain `git gc` on old clones
cannot remove audio reachable from their original commits.

`original/` intentionally retains the original audio history. Preparing a copy
therefore consumes extra desktop space; it does not reclaim the old phone repo
or desktop backups. Keep backups until migration is verified on all devices.

The tool does not automate live `.git` replacement, profile switching, installation,
or phone deletion. It cannot inspect phone-local unsynced data. Mark each of these
steps complete in the handoff only after observing it or obtaining the user's
confirmation.
