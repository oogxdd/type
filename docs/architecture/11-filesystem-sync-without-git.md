# Filesystem-first sync without Git

Type can move away from Git without moving away from Markdown files and real
folders. Those are separate decisions: the filesystem can remain the user- and
export-facing source of truth while Type replaces Git's commit/merge transport.

## What Git currently provides

Git is doing several jobs at once:

- content hashing and efficient transfer;
- an ordered history of snapshots;
- discovery of changed/deleted paths;
- branch/merge ancestry;
- transport interoperability and easy export.

The cost is technical commits, whole-repository merge semantics, a growing
object database on mobile, and awkward treatment of large attachments. Any
replacement must explicitly cover the jobs Type still wants rather than merely
removing `git commit`.

## Recommended replacement: operation journal + content-addressed blobs

Keep ordinary Markdown files in the notes root. Add a device-local index and an
append-only sync journal under app data, not inside the visible notes tree.

```text
FileRecord {
  file_id,             // stable UUID, independent of path
  relative_path,
  content_hash,
  generation,
  modified_hlc,
  modified_by,
  deleted
}

Operation = Put | Move | Delete
```

- A watcher plus explicit editor hooks update the index after atomic saves.
- Markdown bytes and attachments are addressed by cryptographic hash and moved
  with `iroh-blobs`.
- Small signed manifests exchange journal ranges and referenced blob hashes.
- A stable `file_id` makes rename/move distinct from delete-plus-create.
- A hybrid logical clock plus per-device generation identifies concurrent
  changes without trusting wall-clock ordering.
- After acknowledgement by the other device, old journal segments and
  unreferenced blobs can be compacted.

This produces sync checkpoints, not user-visible commits. Ten notes edited
thirty times may create thirty cheap local operations, but history can expose
one logical version per editing session and the journal can compact acknowledged
intermediate states.

## Conflict rule

For the initial two-device product, preserve Type's understandable current
rule rather than introducing character-level CRDT behavior:

- non-concurrent updates apply normally;
- concurrent edits keep the local file and materialize the remote version as
  `name.conflict-<device>.md`;
- concurrent move/edit follows the stable `file_id` to the moved path;
- delete versus concurrent edit preserves the edit and records a visible
  conflict instead of silently deleting it.

The index is reconstructible by scanning the filesystem plus retained journal.
The Markdown folder remains usable with Finder, editors, backups, and simple
zip export even if Type itself is unavailable.

## History options

History no longer needs to equal transport:

1. Keep periodic immutable snapshots (for example, on note close and daily).
2. Store compressed per-file deltas in a local SQLite history database.
3. Retain only the last N versions or N days per note, independently of sync
   journal compaction.
4. Offer an explicit `Export Git history` tool if Git interoperability remains
   useful, generating commits from logical checkpoints rather than autosaves.

This lets the product say "version from yesterday" instead of exposing dozens
of identical `Sync notes` commits.

## Where `iroh-docs` fits

`iroh-docs` can reconcile signed key/value entries whose values reference blob
hashes. It could carry `FileRecord` entries and tombstones, while `iroh-blobs`
carries the bytes. It does not automatically provide filesystem semantics,
rename detection, user-facing history, conflict-file policy, background
availability, or zero-knowledge storage. Type would still need the index,
filesystem projection, encryption-before-storage, and retention rules.

It is attractive if Type later needs many peers or live collaborative state.
For the current phone-plus-Mac workflow, a small Type-specific journal is easier
to reason about and migrate incrementally.

Character-level CRDTs such as Automerge, Yjs, or Loro are a different product
choice. They help simultaneous collaborative editing but make external Markdown
edits, exact formatting round-trips, compaction, and filesystem projection more
complex. They are unnecessary for occasional two-device conflicts.

## Migration path from Git

1. Keep the current Git + SSH-over-Iroh flow and move audio to `iroh-blobs`.
2. Introduce stable file IDs and a shadow journal while Git remains authoritative.
3. Compare journal convergence against Git in tests and real opt-in profiles.
4. Make the journal the sync transport while continuing optional local Git
   checkpoints for rollback/export.
5. Eventually disable automatic Git commits; keep manual Git export as a
   compatibility feature.

This avoids a flag-day migration and preserves the user's plain folder at every
stage.
