# Encrypted sync peer: retention and compaction plan

Status: proposal for later implementation, 2026-09-20. **Not implemented.**
The [current peer](ENCRYPTED_SYNC_PEER.md) retains all published history and
orphaned uploads. This document is not an instruction to delete existing objects.

## Goal and proposed policy

Bound obsolete server storage without giving the VPS a decryption key, changing
local plaintext storage, or losing edits from a device offline for months.
Keep local Git history independently of the peer's retention policy.

Proposed starting policy, to validate with real vault sizes:

- Periodically publish a self-contained encrypted snapshot of current synced
  files, followed by incremental changes within that snapshot generation.
- Always retain the active generation and everything needed to restore it.
- Retain superseded generations for 30 days after supersession. This is a
  recovery window, not a deadline for devices to reconnect.
- Collect abandoned uploads separately, after upload leases and a grace period
  expire. Age alone does not establish that an object is unused.
- Start with manual compaction and a dry-run report. Add automatic scheduling
  after recovery and concurrent-writer tests pass.

These are proposed defaults, not existing settings or storage guarantees.
Live data, recovery generations, and compaction staging still need space.

## Why deleting old objects in v1 is unsafe

The encrypted `Manifest` in
`crates/type-core/src/adapters/mailbox_sync/mod.rs` contains incremental `packs`,
an audio inventory, and a `previous` manifest reference. A recent pack can depend
on old Git objects. Clients follow the predecessor chain back to their locally
pinned head to reject rollback. The VPS cannot decrypt this graph.

A full pack of the existing Git HEAD is not sufficient compaction: it can include
all reachable ancestors and old attachment versions. Deleting old manifests also
breaks verification for offline devices even if current files survive.

## Snapshot generations and Git history

Introduce a versioned manifest with a generation identifier, a self-contained
snapshot inventory, and changes relative to that generation. Include all current
synced files, Git-tracked attachments, and synced settings; preserve existing
device-secret exclusions.

Build a transport-only Git root commit from the current tree, or use a file
snapshot format. Do not rewrite the user's local repository. A separate transport
repository/ref namespace must prevent local historical ancestors from entering
new-generation packs through later merges. Define this separation before coding
compaction; merely resetting the server's pack list fails.

Snapshots must support multiple bounded objects rather than assume the entire
vault fits the current 256 MiB object limit. Existing immutable encrypted audio
objects may be reused. An attachment tracked by the snapshot tree remains live
even without a note linking to it; orphan-attachment cleanup is a separate feature.

## Devices returning after retention expires

Persist a local last-synced baseline sufficient to compute file changes, not just
the server head pin. When switching transport generations:

1. Flush and checkpoint local edits, preserving a recoverable local history ref.
2. Verify the generation transition and download the current snapshot to staging.
3. Compute local changes against the device's own last-synced baseline and merge
   them with remote state. Handle deletions, moves, binary attachments, and
   conflict copies; never overwrite unsent local changes.
4. Publish the merged state in the current generation using head compare-and-swap.
5. Advance the baseline and pin only after durable, recoverable local application.

If the baseline is unavailable, preserve/export local state and require an
explicit recovery choice. Do not silently interpret missing files as deletions
or upload the whole old repository. Device acknowledgements can aid diagnostics,
but a lost phone must not force permanent retention of all bulk history.

## Rollback verification across cleanup

Separate authenticity/freshness verification from bulk Git/audio retention.
Initially retain the encrypted manifest predecessor chain as verification
metadata even after obsolete payloads are collected. A v2 reader must distinguish
references needed to verify history from references needed to restore retained
generations. It must not download expired payloads just to verify the chain.
Keep revisions monotonic across generations.

This leaves metadata growth unbounded initially, and existing audio inventories
can make it sizeable. A later compact transition-proof format needs a separate
design for arbitrary old pins. A checkpoint authenticated with the shared vault
key does not alone prove freshness to an old client. Never silently reset a pin
or accept unrelated history on missing objects. New devices retain v1's limitation:
they have no previous freshness pin.

## Server garbage collection without decryption

The client computes the full retained object set from decrypted manifests. Send
only opaque ciphertext object IDs, vault/generation identity, and the exact
expected head revision to the server. Bind the retention plan to the encrypted
published manifest so clients can detect substitution. The server cannot validate
semantic completeness; correct client marking is essential. Opaque membership
metadata reveals object relationships and lifetimes; document this addition to
the current metadata exposure.

Use durable mark-and-sweep with these invariants:

- Upload and verify the complete snapshot before publishing its head.
- Compare-and-swap publication confirms the starting head is unchanged. A
  concurrent writer requires re-reading, re-merging, and recomputing the plan.
- Protect objects used by current/retained generations, verification metadata,
  and active upload/download leases or pins.
- Serialize sweep decisions with head publication and lease creation. Never use
  a stale keep-set after another writer publishes; abort/recompute on head change.
  Publication referencing a collected object must fail atomically.
- Persist GC progress and quarantine candidates before unlinking. Revalidate
  reachability/protection before unlink. Reads/restores and new publications must
  be able to protect candidates atomically. Restart must preserve these rules.
- Expired transfers restart from a current head; disconnected clients cannot
  retain unlimited server leases.

No unauthenticated delete endpoint, vault key on the VPS, filenames, or plaintext
content hashes are needed. Shared-token authentication is unchanged. This does
not implement per-device revocation or prevent a malicious VPS deleting its disk;
it prevents accidental deletion by honest concurrent clients and crashes.

## Audio deletion and quota pressure

V1 audio is append-only: local absence causes a download, not a tombstone.
Initially retain every published audio object, including those without a note
reference. Removing a note or evicting phone audio must not implicitly authorize
destroying the peer's copy. Later audio cleanup needs explicit synced deletion
semantics, a recovery window, and handling for offline devices with old audio.
A peer receipt remains distinct from desktop durability.

Reserve quota for snapshot staging plus retained generations; show an estimate
before compaction. Insufficient space must leave the old head intact. Never
delete the only restorable generation to make room. Reusing live audio ciphertext
helps, but 30-day retention can delay savings. GC cannot erase independent backups,
device history, or exported copies.

## Implementation sequence

1. Inventory/size reporting and client-generated GC dry runs, without deletion.
2. Version negotiation, transport/local history separation, baseline persistence,
   and generation recovery. Reject unsupported writers before publication;
   migrate v1 only once devices in use support v2.
3. Snapshot publication and offline-device recovery with GC disabled.
4. Lease-aware orphan collection, then retained-generation collection with
   crash-safe quarantine. Reuse the existing local Git operation lock.
5. Policy settings, retained-generation recovery, and automatic scheduling after
   acceptance tests pass with temporary data and a real peer process.

## Acceptance tests

- Fresh device restores notes, Git-tracked attachments, and retained audio after
  old bulk packs have actually been deleted.
- Device offline beyond 30 days returns with edited/deleted/moved notes and
  new/conflicting attachments; no unsent data is lost or silently resurrected.
- Repeated compaction bounds obsolete bulk storage; subsequent uploads do not
  reintroduce old local Git ancestry.
- Concurrent upload/publication/download/compaction, lost acknowledgements,
  interrupted uploads, and restart at each publish/quarantine/unlink boundary.
- Missing baseline/object, quota exhaustion, corrupted snapshot, wrong key,
  stale GC plan, and legacy writer fail without destructive fallback.
- Old pins verify across several generations; rollback and substituted chains
  are rejected even after bulk cleanup.
- Local audio eviction does not delete remote audio; current/retained objects
  survive sweep; peer data and GC logs contain no plaintext or vault keys.

Keep the main peer documentation explicit that retention is absent until these
protocol and recovery changes actually ship.
