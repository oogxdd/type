# Device-local attachment retention

Photo and audio files currently live inside the notes Git working tree. This is
simple and durable, but it means deleting a tracked file on a phone is a synced
deletion. An age rule must not call `remove_file` directly or the next mobile
push can remove the desktop copy too.

## Safe rollout

1. Give every binary a content hash and stable attachment id in note
   frontmatter. Keep the note as the user-visible record even when a device no
   longer caches the bytes.
2. Have desktop write a synced durability receipt after it has fetched and
   verified the binary. The receipt identifies the attachment hash, desktop
   device, and verification time. A successful mobile push alone is not enough:
   it proves the remote accepted data, not that a desktop has retained it.
3. Store retention policy in the existing device-local settings surface, for
   example `audio_retention_days` and `photo_retention_days`. Never sync these
   preferences through `.type/settings.json`.
4. On mobile, prune only binaries older than the policy that have a valid
   desktop receipt. Notes, OCR/transcription text, and frontmatter remain.
5. Represent pruned binaries as a device cache miss, not a Git deletion. The UI
   can offer download-on-demand and show a quiet unavailable-offline state.

## Storage transition

The robust end state is a content-addressed binary store outside the Git
working tree. Git syncs small pointer metadata; local sync transfers missing
blobs separately and each device maintains its own cache. Desktop can use a
keep-forever policy while mobile uses an LRU/age policy.

An incremental interim implementation can keep today's Git layout and mark
acknowledged mobile paths `skip-worktree` before deleting their local bytes.
Every commit/status path must then honor that index flag, and pull must restore
the file only on explicit download. This is workable but more fragile than a
separate blob store, so it should be treated as a migration step rather than the
final storage contract.

## Cleanup invariants

- Never prune a binary while its note is pending upload or lacks a desktop
  durability receipt.
- Never use OCR/transcription completion as proof the original reached desktop;
  a cloud provider may complete before sync.
- Retention runs after sync and is idempotent. A failed delete remains eligible
  for the next pass.
- Panic wipe remains authoritative and removes both metadata and cached bytes.
- Restoring or downloading a pruned binary verifies its content hash before it
  becomes available to the note.
