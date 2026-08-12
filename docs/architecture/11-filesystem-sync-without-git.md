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

## Chosen replacement: `iroh-docs` current state + content-addressed blobs

Keep ordinary Markdown files in the notes root. Use the persistent `iroh-docs`
replica itself as the device-local index, retry queue, and set-reconciliation
engine. Do not add `sync.sqlite` or an application-owned append-only journal.

```text
entry_key = HMAC(vault_id_key, normalized_relative_path)
entry_value = AEAD(vault_object_key, upsert_or_tombstone)
```

- Explicit editor hooks publish after a short debounce; opening the app and the
  manual button also scan/reconcile the filesystem.
- Repeated saves overwrite the same per-author entry for that opaque path.
- `iroh-docs` stores values through `iroh-blobs`, verifies content, resumes
  transfer, persists pending state, and reconciles peer sets.
- Each trusted device has an author identity. Devices compare all authors for a
  path, apply the deterministic winner, and preserve concurrent content.
- Rename is initially represented as tombstone plus upsert; empty folders are
  implicit rather than replicated objects.

This produces convergent current state, not user-visible commits. Ten notes
edited thirty times still leave only one current entry per author and path.
Iroh's blob garbage collection can reclaim values no longer referenced by the
document according to an explicit retention policy.

## Conflict rule

For the initial two-device product, preserve Type's understandable current
rule rather than introducing character-level CRDT behavior:

- non-concurrent updates apply normally;
- concurrent edits keep the local file and materialize the remote version as
  `name.conflict-<device>.md`;
- concurrent move/edit may initially surface as delete/upsert conflicts because
  the opaque key is path-derived;
- delete versus concurrent edit preserves the edit and records a visible
  conflict instead of silently deleting it.

The local replica is reconstructible from the filesystem and peers. The
Markdown folder remains usable with Finder, editors, backups, and simple zip
export even if Type itself is unavailable.

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

## What Type still owns

`iroh-docs` replaces the custom pending database, but it does not provide Type's
filesystem semantics, encryption-before-storage, conflict-file policy,
user-facing history, attachment retention, or product status language. Type
still owns those small policy layers and the Markdown projection.

Character-level CRDTs such as Automerge, Yjs, or Loro are a different product
choice. They help simultaneous collaborative editing but make external Markdown
edits, exact formatting round-trips, compaction, and filesystem projection more
complex. They are unnecessary for occasional two-device conflicts.

## Migration path from Git

1. Opt a profile into encrypted `iroh-docs` with a one-time trusted-device QR.
2. Sync Markdown, ordering metadata, and shared settings without committing.
3. Keep the existing Git commands available as manual snapshots/export during
   the experiment, not as the automatic transport.
4. Move encrypted audio through the document blob store and connect desktop
   durability receipts to the seven-day mobile eviction policy.
5. Add explicit retention/GC, revocation, and a tested peer handoff before
   calling the persistent-peer topology production-ready.

This avoids a flag-day migration and preserves the user's plain folder at every
stage.
