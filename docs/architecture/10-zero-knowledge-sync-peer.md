# Zero-knowledge sync peer

This is an optional future topology for syncing while the phone and computer
are never online at the same time. It is deliberately not part of the direct
phone-to-Mac experiment.

## Goal and trust boundary

The sync peer is an untrusted, always-online mailbox. It may store, list, and
delete opaque objects, but it must not possess any key that decrypts notes,
filenames, folder names, transcripts, audio, manifests, or acknowledgements.

Iroh's QUIC/TLS connection protects bytes in transit. That protection ends at
an Iroh endpoint, so a VPS acting as a peer would see plaintext unless Type
encrypts the payload before giving it to Iroh. Application-layer encryption is
therefore mandatory; using a private VPS or `iroh-docs` does not remove this
requirement.

The server will still observe connection metadata: account/vault identifier,
IP addresses, timing, object count, and approximate byte sizes. Padding and
batch uploads can reduce size and timing leakage but cannot make a single-hop
mailbox anonymous.

## Keys

- Each vault has a random 256-bit vault root key created on a trusted device.
- Pairing transfers that key directly through the QR/device-to-device channel.
- Each device also has a signing key and a stable device identifier.
- The server receives public signing keys and opaque authorization tokens, but
  never the vault root key or a plaintext recovery copy.
- Losing every paired device and the optional offline recovery key permanently
  loses the data. This is an accepted property, not a recovery bug.

Derive separate subkeys for object encryption, manifest encryption, and opaque
server lookup identifiers. Domain separation prevents one protocol surface
from reusing another surface's key material.

## Stored objects

Use encrypted current-state envelopes:

```text
opaque_object_id = HMAC(id_key, normalized_relative_path)
ciphertext = XChaCha20-Poly1305(
  object_key,
  random_nonce,
  plaintext,
  aad = vault_version || object_kind || opaque_object_id
)
```

The stable HMAC key lets repeated saves of the same path replace that device's
existing Iroh entry. The peer cannot dictionary-test filenames without the
derived id key. A random nonce makes equal contents produce different
ciphertext, and authenticated encryption detects modification. Upserts and
tombstones use the same envelope framing.

## Sync flow

1. The phone atomically saves Markdown locally.
2. After a short debounce it writes the encrypted current state under the
   stable opaque file key. Several autosaves replace one per-author entry; they
   do not create Git commits or an application-owned operation queue.
3. `iroh-docs` reconciles entries directly with the Mac or persistent peer.
4. The Mac later decrypts and projects the winning state back to its ordinary
   Markdown folder. Concurrent content is preserved as a conflict sibling.
5. The Mac publishes its own baseline for the received file, which can later
   serve as the basis for an encrypted durability acknowledgement.
6. Phone audio is eligible for deletion only after the current seven-day and
   completed-transcription checks plus an exact Mac durability receipt.

`iroh-blobs` is suitable for encrypted audio chunks: encrypt first, then add
the ciphertext to the blob store. Its BLAKE3 addressing and verified resume
then protect the ciphertext transfer without revealing the original bytes.

## Rollback and malicious-server behavior

Encryption prevents reading and undetected mutation, but a malicious peer can
drop data, withhold new objects, replay an old view, or exhaust device storage.
Mitigations:

- every device signs manifests and receipts;
- manifests include a per-device monotonic sequence and previous-manifest hash;
- clients remember the highest accepted sequence locally and reject rollback;
- object sizes, counts, and per-vault quotas are bounded before download;
- ciphertext is replicated/backed up independently of the mailbox;
- deletion uses a grace period and requires acknowledgements from the devices
  selected by the user's retention policy.

The server cannot guarantee availability or truthful freshness. The UI should
distinguish `Uploaded to mailbox` from `Received by computer`.

## Authorization and pairing

Do not treat knowledge of an Iroh EndpointId as authorization. Bind each paired
device's Iroh identity to its Type device signing key during QR pairing and
allowlist it. Add request authentication, replay protection, quotas, and rate
limits even though payloads are encrypted; otherwise an attacker can fill the
mailbox or desktop disk with validly transported garbage.

## Incremental implementation

### Options considered

| Option | Useful parts | Why it is or is not the first choice |
| --- | --- | --- |
| Plain Iroh relay | NAT traversal and encrypted packet forwarding | Stateless; cannot accept a phone upload while the Mac is offline. |
| Custom mailbox protocol | Small wire surface and complete policy control | Type would have to invent and maintain set reconciliation, cursors, blob availability, and retry semantics. |
| Encrypted Git bundles | Reuses Git object and merge semantics | Still needs a durable index, acknowledgement protocol, attachment handling, and bundle lifecycle. Useful as an envelope payload, not as the peer itself. |
| `iroh-docs` with plaintext entries | Persistent replication, CRDT metadata, blobs, gossip | The peer replica sees entry keys and can fetch values, violating the zero-knowledge goal. |
| `iroh-docs` with opaque keys and encrypted values | Persistent replication, set reconciliation, blobs, live notifications, read-only replicas | Chosen foundation. Type still owns encryption, operation semantics, rollback detection, receipts, retention, and UI. |
| HTTPS object storage | Mature durability and cheap storage | A viable fallback, but introduces provider credentials and a second transport while the app is already using Iroh. |

### Decision: encrypted current filesystem state over `iroh-docs`

Use one Iroh document per Type vault. Trusted devices receive the document's
write capability plus the Type vault root key during pairing. The always-online
sync peer receives only a read capability. It can replicate valid signed entries
and their blobs but cannot create namespace-valid entries.

Neither the Iroh document key nor its blob values are Type plaintext:

- every entry key is a stable 32-byte HMAC of the normalized relative path;
- every entry value is a Type encrypted envelope;
- path, filename, object kind, device id, sequence, predecessor, hashes, note
  bytes, and attachment bytes are all inside the envelope;
- `iroh-docs` author signatures authenticate the writing replica, while the
  Type envelope's AEAD prevents a read-only peer from producing valid content;
- the peer still observes namespace id, author public ids, timestamps, opaque
  keys, content hashes, sizes, and connection metadata.

Each author has at most one current entry for a path. The value describes an
`upsert` or tombstone, but the Iroh document is the reconciliation state and
durable queue: there is no `sync.sqlite` or append-only Type journal. A device
groups the entries for a key, projects the winning state to the filesystem, and
preserves concurrent content using a deterministic `.conflict-<hash>.md`
sibling. It then publishes a local baseline. Git is outside this hot path and
may still be used manually for snapshots or export.

`iroh-docs` is a useful sync engine here, but it is not a security boundary and
does not make the design automatically production-ready. Type must encrypt
before `set_bytes`, use opaque keys, bound downloads, and retain independent
backups. Stable per-path keys intentionally leak update linkage for the same
unknown path; they do not reveal the path itself.

### Delivery slices

1. Define and test the encrypted envelope and stable opaque per-path ids.
2. Add the persistent `iroh-docs` client store and project Markdown, ordering,
   and shared settings with conflict preservation and no automatic Git commits.
3. Add the standalone persistent read-only peer and prove phone-online → peer →
   phone-offline → Mac-online in an integration test.
4. Move encrypted audio through the document's blob store and issue an encrypted
   Mac durability receipt before the seven-day phone eviction policy can run.
5. Add device revocation, signed receipt chains, rollback warnings, quotas,
   garbage collection, backup/replication, and operational monitoring that
   never logs plaintext or keys.
