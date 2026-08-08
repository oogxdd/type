# Automatic sync — design exploration

> **Status:** design notes, not implemented. This captures the options for making
> sync automatic (no manual "Sync" button) and the trade-offs of each transport,
> including non-Git backends. Nothing here changes current behavior yet.

## Requirements (fixed for this exploration)

1. **Bidirectional** — phone ↔ desktop, both directions auto. Not just "phone
   pushes, desktop catches up."
2. **Desktop is _not_ always online** — we cannot assume the desktop is reachable
   when the phone wants to sync. This is the decisive constraint (see below).

## The key split: orchestrator vs. transport

"Automatic sync" is really two independent problems:

- **Orchestrator** — _when_ to sync: the background loop and its triggers.
  This is the same code regardless of transport.
- **Transport** — _how/where_ bytes move: LAN SSH server, internet Git host,
  managed relay, object storage, a cloud file provider, etc.

Roughly 90% of the work is one good orchestrator. "Same network vs. internet"
and "Git vs. non-Git" are just which transport sits underneath it.

Everything downstream is already conflict-safe: a pull that diverges keeps
"ours" and writes "theirs" as a `.conflict.md` sibling — the merge always
completes, so an automatic loop can run without risk of a blocking conflict
state. (See `AGENTS.md` → merge conflict resolution, and `docs/LOCAL_SYNC.md`.)

## What "desktop not always online" forces

Bidirectional sync means: while device A is offline, device B still makes edits,
and those edits must survive until A comes back. Something has to **hold state
while a peer is offline.**

- If the desktop were always on, it could _be_ that always-available peer
  (tunnel/VPN into the desktop's embedded SSH server — the internet extension of
  local sync). With constraint (2), that option is off the table for the
  internet case.
- Therefore, for **cross-network** sync we need an **always-available third
  party** that is not one of the two end devices: a Git host, a managed relay,
  an object store, or a cloud file provider.

This does **not** affect the same-network case, where both devices are online
together by definition.

## Scenario 1 — same network, just no button

Transport already exists: the desktop hosts an embedded SSH Git server and
advertises `_typenotes-sync._tcp` over mDNS; the phone can `discover_peers`.
Only the orchestrator is missing.

Recommended trigger set (hybrid):

- **On local change**, debounced well above the editor's 400ms autosave (e.g.
  commit+sync no more than every few seconds) so we don't sync per keystroke.
- **On foreground / unlock** — sync when the app becomes active.
- **On peer discovery** — when mDNS surfaces the desktop, run a sync.
- **Safety-net timer** — a slow poll (e.g. 30–60s) to catch anything the event
  triggers missed.

Bidirectional here = the existing `pull` then `push` pair, just invoked by the
loop instead of a button. No new transport, no new backend.

## Scenario 2 — different networks (over the internet)

Because the desktop may be offline, we need an always-on rendezvous. Options,
ordered by how much new backend they require. The orchestrator is the same loop
as Scenario 1 — only the remote changes.

### Git-based (reuse everything we already have)

**2A. User-provided Git remote (GitHub / GitLab / Gitea / self-hosted).**
We already support `ssh://` and `https://` remotes with app-managed Ed25519 keys
and history. Auto-sync = the Scenario-1 loop pointed at this remote. The host is
the always-available third party, so it satisfies constraint (2) even when the
desktop is asleep.
- ✅ Essentially zero new backend; auth/history/conflict handling already exist.
- ⚠️ User needs an account + repo. Less "local-first with no host."

**2B. Managed relay we host.** A minimal SSH/Git endpoint that auto-provisions a
per-user repo; the user configures nothing.
- ✅ Zero-config, "just works."
- ⚠️ We own infra, storage cost, privacy. Note: **only the note _body_ is
  encrypted at rest** — file names and front-matter are plaintext, so a hosted
  store sees metadata unless we add filename/metadata encryption first.

## Non-Git alternatives

The current model is Git-over-files, which is why conflict handling and history
come for free. Moving off Git means re-earning those. Still, some backends fit a
notes app well. Each below still needs the same orchestrator and still needs an
always-on store for the offline-desktop case.

**N1. Object storage (S3 / Cloudflare R2 / Backblaze B2).**
Treat each `.md` as a blob; keep a small per-profile manifest (path → hash,
mtime, tombstone). Sync = diff manifests, upload/download changed blobs.
- ✅ Cheap, simple, scales, no server to run (just a bucket).
- ⚠️ We implement merge ourselves — last-writer-wins per file, or replicate the
  `.conflict.md` scheme. No built-in history.
- ⚠️ Metadata (filenames) visible to the store unless encrypted.

**N2. Cloud file provider (iCloud Drive / Dropbox / Google Drive).**
Let the provider move bytes; the app just points its notes root at a synced
folder and watches for changes.
- ✅ Least code — transport, offline queueing, and conflict copies are the
  provider's job. Naturally always-online.
- ⚠️ Their conflict model (e.g. "note (conflicted copy).md") not ours; partial
  writes and .md-file races are possible; platform-specific (iCloud is
  Apple-only, needs entitlements). Weak control over timing.

**N3. CRDT sync (Automerge / Yjs) + a small sync/relay server.**
Represent note bodies as CRDT documents; devices exchange ops via a relay or
peer channel and converge without conflict files.
- ✅ True merge-free concurrent editing, real-time feel, works offline-first by
  design.
- ⚠️ Largest rework: notes are plain `.md` on disk today; we'd add a CRDT layer
  and a materialize-to-`.md` step. Still needs a relay for the offline-peer case.

**N4. Custom document/sync server or BaaS (Supabase / Turso / PocketBase / Firebase).**
Store notes as rows/documents; sync via timestamps or a vector clock + tombstones.
- ✅ Full control over the API, per-note granularity, real-time subscriptions.
- ⚠️ We build and run the backend + its own conflict resolution and auth;
  biggest ongoing ownership.

## Comparison

| Option | Transport | Backend to build/run | Handles offline desktop | Conflict model | Effort |
| --- | --- | --- | --- | --- | --- |
| 1. Same network | embedded SSH + mDNS | none (exists) | n/a (both online) | `.conflict.md` (exists) | orchestrator only |
| 2A. User Git remote | ssh/https Git host | none (exists) | ✅ host is always-on | `.conflict.md` (exists) | orchestrator only |
| 2B. Managed relay | our SSH/Git endpoint | relay + storage | ✅ | `.conflict.md` (exists) | infra + orchestrator |
| N1. Object storage | S3 / R2 / B2 | bucket + manifest logic | ✅ | we implement (LWW / conflict copies) | medium |
| N2. Cloud file provider | iCloud / Dropbox / Drive | none | ✅ | provider's own | low code, platform-bound |
| N3. CRDT + relay | Automerge / Yjs + relay | relay | ✅ | merge-free (CRDT) | high (rework) |
| N4. Custom / BaaS | HTTP / realtime API | full backend | ✅ | we implement | high |

## Recommendation

- **Same network (1):** build the orchestrator now — the transport is done.
- **Internet (2):** start with **2A** (user Git remote); it's the smallest diff
  over today's code and already satisfies the offline-desktop constraint. Offer a
  zero-config tier later via **2B** or **N2**, whichever wins on
  privacy/effort — and gate any hosted option on encrypting filenames/metadata,
  since only note bodies are encrypted today.
- **Non-Git** only pays off if we want a capability Git can't give cheaply:
  **N3 (CRDT)** for real-time merge-free editing, or **N2** for near-zero code.
  Otherwise Git already gives us history + a working conflict scheme for free.

## Migration cost: object storage vs. cloud provider

How much work is it to actually move off Git to one of these? Grounded in the
current code (`crates/type-core/src/adapters/git/`, the `git_sync`
application/ports/commands surface, and the mobile sync store).

### What Git gives us for free that a non-Git backend must re-earn

1. **Change detection** — Git knows which files changed via trees/commits.
   Without it we maintain a per-profile **manifest** (path → content hash, mtime,
   tombstone) and diff two manifests.
2. **3-way merge + `.conflict.md`** — today's conflict scheme rides on Git's
   merge against a common ancestor. A blob store only knows "these two versions
   differ"; to get anything better than last-writer-wins we track a base version
   per file ourselves.
3. **Deletes** — Git records deletions; a manifest needs explicit tombstones.
4. **History** — `git log`. Gone unless we keep versioned objects.
5. **Atomic commit** — one commit flips many files at once; per-object uploads
   are not atomic across a note set (partial-sync windows to handle).

### Object storage (N1 — S3 / R2 / B2)

- **Transport is cheap**: `reqwest` (blocking + rustls) is already a core
  dependency, so signing + PUT/GET/LIST against an S3-compatible API needs no new
  stack. A thin client or `opendal`/`object_store` crate covers it.
- **The real work is the sync engine, not the transport**: manifest build (walk
  `notes_root`, hash files), manifest diff, upload/download changed blobs, apply
  tombstones, and a merge policy (start LWW, or replicate `.conflict.md` by
  keeping a base manifest). This is the bulk of the effort.
- **Wiring**: a new adapter behind a sync gateway port, parallel to git; new
  credential storage alongside `.type/device.json`; then plumb through
  application → commands (Tauri) → FFI (`#[uniffi::export]`) → desktop UI +
  mobile store. Two shells, so the surface work is doubled (see AGENTS.md).
- **Estimate: medium.** Weeks, dominated by getting bidirectional merge correct,
  not by talking to the bucket.

### Cloud file provider (N2 — iCloud / Dropbox / Drive)

The cost splits hard by platform:

- **Desktop**: if the provider mounts a real folder, point `notes_root` at it and
  watch the filesystem. **Near-zero backend code** — the provider owns transport,
  offline queueing, and conflict copies.
- **Mobile is the catch**: iOS apps are sandboxed. iCloud Drive needs the app's
  own container + entitlements + a native module; Dropbox/Drive are API-based,
  not a mountable filesystem — so on mobile they collapse into **N1 with a
  different store**, not the free desktop path.
- **Other downsides**: their conflict model ("note (conflicted copy).md"), not
  ours; `.md`-file write races and partial writes; weak control over sync timing.
- **Estimate: low on desktop-only, medium once mobile is real.**

### Bottom line on migration

Object storage is a **medium, self-contained** project whose hard part is the
merge engine. Cloud provider looks cheapest but only genuinely is on desktop; on
mobile it turns back into "build the sync engine." Neither is a quick swap,
because both re-implement what Git currently hands us for free.

## At-rest encryption: yes, and more than we have today

**This is the real prerequisite before any hosted/cloud tier**, more important
than which backend you pick.

Today (confirmed in `adapters/security.rs`): only the note **body** is encrypted
(XChaCha20-Poly1305, Argon2id-derived key). `render_note_with_front_matter`
wraps the encrypted body in **plaintext front-matter**, and filenames are
plaintext by design. Recordings/attachments are **not encrypted at all**.

For a store you don't control, "body only" leaks a lot:

- **Filenames** — new notes auto-rename to a **content slug**
  (`…-buy-milk.md`), so the filename itself often reveals the note.
- **Folder names** — your topic structure.
- **Front-matter** — timestamps, tags, recording references.
- **Audio/image attachments** — fully in the clear.

So the right move is to extend from "encrypted body" to **end-to-end encryption
of the whole object before it leaves the device**:

1. Encrypt the **entire note file** (front-matter + body) into one opaque blob.
2. Map real path → an **opaque object key** (random id, or an HMAC of the path)
   so filenames and folder structure don't leak; keep the plaintext↔key mapping
   in an **encrypted manifest**.
3. Encrypt **attachments** too.
4. Reuse the existing primitives — the Argon2id/XChaCha20 key in
   `SECURITY_RUNTIME` — rather than inventing a second scheme.

**Useful synergy:** whole-file encryption makes line-level 3-way merge
impossible (the host only sees ciphertext), so you fall back to file-level
last-writer-wins / conflict-copies. **Object storage already works that way** —
so encryption fits N1 naturally, whereas it would neuter Git's merge. If you're
going encrypted **and** hosted, object storage is the more coherent pairing.

Trade-off to accept: encrypted metadata means server-side search/indexing is off
the table (fine for a local-first app — search stays on-device).

## Open questions

- Where does the orchestrator live — `application/git_sync` in the core (shared
  by both shells) or per-shell (mobile store + desktop hook)? Leaning core, so
  triggers/backoff are written once.
- Debounce vs. active editing: never sync mid-keystroke; coordinate with the
  400ms autosave and `flushSave()` before a sync commit.
- Network/battery policy on mobile (Wi-Fi only? backoff on repeated failures?).
- Metadata encryption: required before any hosted (2B / N1 / N4) tier.
