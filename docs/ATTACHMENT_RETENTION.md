# Device-local attachment retention

## Current storage and transport

Audio files remain on disk under `Recordings/` inside the notes root, but new
recordings in an Iroh working folder are excluded from Git. Notes and transcripts
sync through Git first; recordings transfer separately over Iroh afterward.
Failed audio pairing leaves recordings on the phone for retry, without silently
putting them into Git. Manual checkpoints also respect the exclusion when the
working folder has an Iroh ticket.

Ordinary Git-only connections still carry recordings through Git. Handwriting
photos under `Attachments/` also remain tracked; the audio retention policy does
not apply to them. Deleting a tracked attachment is a synced deletion and does
not remove its bytes from historical Git objects.

## Seven-day phone audio cache

`crates/type-core/src/adapters/attachment_retention.rs` implements a fixed
seven-day minimum age. There is currently no configurable retention setting.
A recording is eligible for removal from the phone only when:

1. Its creation time (or audio modification time when creation time is missing)
   is at least seven days old.
2. Its transcription status is `completed`.
3. The desktop durability receipt matches the local file's SHA-256 and length.
4. The audio path is not tracked in the current Git index.

The Markdown note, transcript, and frontmatter remain. Missing audio with cache
or receipt metadata is represented as archived on the desktop. This is not a
promise of automatic download-on-demand.

The tracked `.type/audio-durability-receipts.json` records verified desktop
copies. `.type/audio-cache.json` stores device-local upload acknowledgements and
cache eviction records, and is excluded from Git. A direct upload acknowledgement
alone does not authorize deletion: the tracked desktop receipt is required.
An empty desktop receipt manifest is authoritative and can revoke prior receipts.

Maintenance runs while the app is active, after a standalone pull or after notes
push/audio archiving. The combined sync does not wait for pruning before pushing
notes. Seven days is a minimum age, not a guaranteed background deletion deadline;
untranscribed, unacknowledged, and legacy tracked recordings remain longer.

Receipt manifests are read once per archive/prune pass. Audio content is still
hashed before trusting a match; the optimization does not remove integrity checks.

## Legacy recordings and history cleanup

Audio already tracked by Git is not untracked merely by adding an exclude rule.
The cache pruner retains it and reports `waiting_for_git_migration`. Removing
only its working-tree copy would leave historical audio bytes in `.git`.

Use [Audio history migration](AUDIO_HISTORY_MIGRATION.md) for the verified-copy
tool and coordinated desktop/phone procedure. It preserves text history while
removing recording storage directories from historical trees. Old phone clones
must not merge into the cleaned history afterward.

Do not use `skip-worktree` as the new retention mechanism. Compatibility handling
for old index flags is not a substitute for keeping recordings outside Git.

## Cleanup invariants and future work

- Never evict audio without completed transcription and a matching tracked
  desktop receipt; transcription alone does not prove desktop durability.
- Retention changes device-local cache state, not the note's existence or the
  desktop's recording file. A failed deletion is retried on a later pass.
- Photo retention, configurable age policies, and download-on-demand are separate
  work; do not assume they exist because audio eviction is implemented.
- Panic wipe remains a separate explicit local-data removal flow.

See [Iroh sync](IROH_SYNC_EXPERIMENT.md) for transport and receipt behavior.
