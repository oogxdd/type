# Object-storage sync

> **Status:** implemented, both phases. Supersedes the transport half of
> [`AUTO_SYNC.md`](./AUTO_SYNC.md), which explored the options; this document
> records the decision, the design that follows from it, and what shipped.

Automatic, background sync between desktop and phone over an **S3-compatible
bucket the user brings themselves** (Cloudflare R2, Backblaze B2, AWS S3, MinIO,
Wasabi, Storj, …). No server we run, no button to press, no Git host.

Shipped in two phases:

1. **Phase 1** — objects are stored as-is (plaintext bytes).
2. **Phase 2** — everything is end-to-end encrypted before it leaves the device.

The two phases share one layout and one engine on purpose; phase 2 changes how
object keys and payloads are produced, not how sync works.

## Why object storage and not Git

The existing Git transport stays — it is still the best answer for LAN sync
(embedded SSH server + QR pairing) and for anyone who *wants* a versioned repo.
This is an additional transport behind its own port, not a replacement. But for
the "just keep my notes in sync, everywhere, automatically" path, Git loses on
three specific points:

**1. Encryption is the deciding factor.** Phase 2 is the actual goal, and
whole-file encryption is precisely what destroys Git's value:

- Git's 3-way merge needs to read the file. Encrypted, it can't — every
  concurrent edit degrades to a conflict, so we'd be implementing file-level
  conflict handling *anyway*, on top of Git.
- Git's delta compression needs similar blobs. Ciphertext is incompressible and
  shares no deltas, so every edit stores a full new copy of the note.
- Hiding filenames means rewriting every path to an opaque id, because tree
  entries are plaintext. At that point Git is a blob store with a heavy
  protocol attached.

Object storage *is* a blob store with opaque keys. Encryption costs it nothing.

**2. Auto-commit and Git history are in tension.** "Commit on a debounce" for a
notes app means thousands of commits a year, each one a full tree. That history
lives on the phone too. Object storage overwrites instead of appending, so
steady-state size tracks the size of your notes, not the number of edits.

**3. HTTP beats SSH on mobile.** Plain signed HTTPS requests are per-object,
retryable, and survive flaky networks. A libgit2 push is one long transaction
that either finishes or doesn't.

What we give up, and the answer to each:

| Git gives free | Without it |
| --- | --- |
| Change detection | Per-device manifest (path → hash), diffed each round |
| 3-way merge | File-level: keep local, save remote as `.conflict.md` — **the same behavior users already get from Git sync today**, since that's what the existing conflict path does |
| Deletes | Explicit tombstones in the manifest |
| History | Bucket versioning if the provider offers it; otherwise none. Accepted — see "Open questions" |
| Atomic multi-file commit | Content-addressed blobs make partial syncs safe rather than atomic (below) |

### The tradeoff worth naming

Objects are **content-addressed** (`objects/<hash>`), not a mirror of the folder
tree. You cannot open the bucket and browse `Feed/buy-milk.md`. That is
deliberate — see "Why content-addressed" — and it is moot in phase 2, where the
contents are ciphertext regardless. If a browsable copy matters, the existing
profile export ("export to Documents") already produces one.

## Bucket layout

```
<prefix>/
  repo.json                    format version + encryption mode (plaintext, no secrets)
  vault.json                   phase 2 only: passphrase-wrapped vault key + KDF params
  manifests/<device_id>.json   one per device — each device writes only its own
  objects/<object_key>         content-addressed, immutable blobs
```

`<prefix>` defaults to `type-notes/<profile_id>` so one bucket can hold several
working folders.

### Why content-addressed

The naive layout — `objects/Feed/note.md`, one shared `manifest.json` — has a
silent data-loss bug. Two devices syncing at once both read the manifest, both
write it, and the second write erases the first one's entry. The note's bytes
are in the bucket but nothing points at them; the next sync sees the path
"reverted" and overwrites a good local file with a stale one.

Content-addressing plus per-device manifests removes the race instead of
detecting it:

- **Blobs are immutable.** A given hash always names the same bytes, so an
  upload never overwrites anything. Identical content across notes or devices
  uploads once.
- **Each device owns exactly one manifest file**, so there is no contended
  write anywhere in the protocol. The remote view is the *merge* of all device
  manifests, computed client-side.
- It needs no conditional-write support, so it works identically on R2, B2,
  MinIO and S3 rather than only where `If-Match` is implemented.

The cost is garbage: superseded blobs stay until collected. GC is a list, a
subtraction against every device manifest, and a delete of anything unreferenced
and older than a grace period — run rarely, and only from desktop.

## The sync round

Three inputs, which is what makes conflict detection possible at all:

- **base** — the merged remote view as of our last successful sync, persisted
  device-locally at `.type/object-sync-state.json`.
- **local** — a fresh scan of `notes_root`.
- **remote** — the merge of every `manifests/*.json` in the bucket right now.

Merging remote manifests is per-path highest-revision-wins. Ordering by
timestamp turned out to be unsound: device clocks disagree, filesystem mtimes
are coarse, and a genuinely newer edit can carry an older-looking stamp. Each
entry therefore carries a **revision** that encodes causality — a device
editing a file it has already synced necessarily produces `base.rev + 1`, so its
version wins without any clock being trusted. Equal revisions mean the edits
were genuinely concurrent, which is exactly the conflict case. Ties break on
liveness, then stamp, then hash, so every device computes the same answer.

Then, for each path in the union of the three:

| local vs base | remote vs base | Action |
| --- | --- | --- |
| same | same | nothing |
| changed | same | upload |
| same | changed | download |
| changed | changed, same hash | converged — just record it |
| changed | changed, different hash | **conflict** |

Conflicts never block and never lose bytes:

- **both edited** → keep local, write the remote version beside it as
  `note.conflict.md`. The conflict file is then an ordinary note that syncs like
  any other.
- **deleted here, edited there** → the edit wins; the file comes back.
- **edited here, deleted there** → the edit wins; it is re-uploaded.
- **both deleted** → deleted.

Deletion always loses against a concurrent edit. That is the safe direction: the
worst case is a file you have to delete twice, rather than one you can't get
back.

Finally the device writes its own manifest and persists the new base. If the
round dies partway, nothing is corrupted — blobs uploaded so far are immutable
and simply get referenced by the next round.

### What gets synced

Everything under `notes_root` — including `Recordings/` and `Attachments/`,
which means audio and handwriting images now sync too (and, in phase 2, get
encrypted, which today they never are). Excluded: `.git/`, the device-local
`.type/device.json` and `.type/object-sync-state.json`, and OS debris
(`.DS_Store`, `Thumbs.db`).

Hashing every file every round would be wasteful once recordings are involved,
so the local state caches `(size, mtime_ms) → hash` and only re-hashes files
whose size or mtime moved. With one exception: files touched in the last few
seconds are **always** re-hashed. Filesystem mtime granularity can be a full
second, so a note saved twice in quick succession to the same length is
indistinguishable from an untouched one, and trusting the cache there drops the
second edit silently. Git solves the same "racy timestamp" problem the same
way.

## The orchestrator

Transport aside, "sync without pressing a button" is one small scheduler, and it
lives in the core so both shells share one policy:

- `request_sync(reason)` marks the profile dirty and wakes a worker thread
  (`std::thread` + `Condvar` — the core has no tokio on iOS/Android).
- The worker coalesces requests, waits out a short debounce after the last one,
  keeps a minimum gap between completed rounds, and never runs two rounds at
  once.
- Failures back off exponentially up to a ceiling; the next explicit request
  resets it.

The shells own only the *triggers*, because those are platform-specific: note
write and editor flush, screen/app foreground, manual sync, and a slow
safety-net timer.

## Phase 2 — end-to-end encryption

The bucket sees ciphertext and opaque keys, and it never sees anything that
could derive a key. Provider compromise reveals only the number of objects and
their approximate sizes.

### Keys

A random 256-bit **vault key** is generated once, on the device that enables
encryption. It is never sent anywhere in the clear. What lives in the bucket is
the vault key **wrapped** by a key derived from the user's secret phrase:

```
KEK          = Argon2id(phrase, salt, m=64MiB, t=3, p=1)
vault.json   = { kdf params, salt, XChaCha20-Poly1305(KEK).seal(vault_key) }
```

Wrapping rather than deriving directly means changing the phrase re-wraps 32
bytes instead of re-encrypting every note.

Three subkeys come off the vault key via HKDF-SHA256, so no key is ever used for
two purposes:

- `k_name` — HMAC key that turns a content hash into an object key
- `k_content` — encrypts blob payloads
- `k_manifest` — encrypts manifests

### On the wire

- **Object key** = `hex(HMAC-SHA256(k_name, sha256(plaintext)))`. Deterministic,
  so two devices independently compute the same key for the same note and
  dedup still works — while the bucket learns nothing about the content.
- **Payload** = `magic || nonce || XChaCha20-Poly1305(k_content).seal(bytes)`
  with the object key as **AAD**, which binds a blob to its location so a blob
  cannot be swapped for another one.
- **Manifests** use the same envelope under `k_manifest`. Paths, filenames,
  folder structure, timestamps and tombstones are all inside, so none of it
  leaks — which is exactly the gap that made a hosted tier untenable before.
- **In transit** is TLS to the provider, underneath all of the above.

Note the scope difference from the existing app-lock encryption
(`.notes-security.json`): that one encrypts note *bodies* on local disk and
leaves front-matter and filenames plaintext by design. This is a separate,
whole-file layer that applies only to what leaves the device. They compose —
neither replaces the other.

### The UX

The hard part of E2EE is the second device, so there are two paths to it:

- **QR (the fast path).** The desktop already renders a pairing QR for LAN sync.
  The same screen offers a cloud-pairing QR carrying bucket config *and the
  vault key* — the phone scans it and is fully configured with nothing typed.
- **Secret phrase (the fallback, and the recovery path).** Enter the phrase on
  the phone; it fetches `vault.json`, derives the KEK, and unwraps. A wrong
  phrase fails on the AEAD tag — no separate check value is needed.

Because the phrase only protects a wrapped copy of a random key, and an attacker
needs bucket credentials before they can even attempt it, a user-chosen phrase
is acceptable here in a way it would not be if the key were derived from it
directly. We still gate enabling encryption behind a "write this down" step:
the phrase is not stored anywhere, so losing it with no configured device left
means the bucket is unreadable. Any *configured* device can re-wrap under a new
phrase at any time.

### Turning it on

Enabling encryption publishes `vault.json` first (so a failure leaves a
plaintext bucket rather than one nobody can unlock), flips `repo.json` to
`encryption: "v1"`, deletes the plaintext objects and manifests, and re-uploads
everything under the new keys. Local notes are never touched.

Every device records the bucket's mode alongside its base state. When the two
disagree — because another device just re-keyed the bucket — the device resets
its base rather than acting on it. This matters more than it looks: after a
re-key, a stale base describes a bucket that no longer exists, and every path
in it would read as "deleted remotely". Resetting costs one full compare, and
identical content converges on its hash, so nothing is re-uploaded needlessly
and nothing is lost.

## Open questions

- **History.** Object storage gives none. Bucket versioning covers accidental
  deletion where the provider supports it; a `versions/` prefix keeping the last
  N revisions per note is the cheap in-app answer if it turns out to be missed.
- **Mobile network policy.** Wi-Fi-only toggle, and whether recordings should
  wait for Wi-Fi while notes go over cellular.
- **GC cadence.** Currently manual/desktop-only. Weekly on a timer is probably
  right, but it needs the grace period tuned against how long a device can stay
  offline holding a reference to an old blob.
- **Credential entry on desktop.** Access key + secret is a technical ask. A
  provider-specific quick-start (R2 has a free tier and zero egress fees) would
  cut most of the friction. The phone already avoids it entirely by scanning
  the desktop's pairing QR.
- **Turning encryption back off.** Not implemented. It would mean another full
  rewrite of the bucket, in the less safe direction, and nobody has asked.
- **Changing the secret phrase.** The design supports it — re-wrap 32 bytes and
  re-upload `vault.json` — but there is no UI for it yet.
