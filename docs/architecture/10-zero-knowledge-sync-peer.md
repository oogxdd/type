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

Use immutable encrypted envelopes:

```text
opaque_object_id = HMAC(id_key, random_object_id)
ciphertext = XChaCha20-Poly1305(
  object_key,
  random_nonce,
  plaintext,
  aad = vault_version || object_kind || opaque_object_id
)
```

Random object identifiers avoid exposing hashes of predictable plaintext.
Authenticated encryption detects modification. Notes, Git bundles, manifests,
audio chunks, tombstones, and receipts all use the same envelope framing but
different object kinds and derived keys.

The peer API can stay intentionally small:

```text
PUT    /vault/{opaque-vault}/objects/{opaque-id}
LIST   /vault/{opaque-vault}/changes?after={opaque-cursor}
GET    /vault/{opaque-vault}/objects/{opaque-id}
POST   /vault/{opaque-vault}/acks
DELETE /vault/{opaque-vault}/objects/{opaque-id}
```

An Iroh protocol can expose equivalent operations without HTTP. Storage
semantics, encryption, quotas, and acknowledgement rules remain application
responsibilities either way.

## Sync flow

1. The phone saves locally and creates an encrypted immutable change package.
2. The phone uploads it to the mailbox and may close immediately after the
   peer durably acknowledges the ciphertext.
3. The Mac later lists opaque changes, downloads, authenticates, decrypts, and
   applies them locally.
4. The Mac emits an encrypted, signed receipt naming the exact applied object
   and resulting content hash.
5. The phone downloads the receipt on a later session.
6. Phone audio is eligible for deletion only after the current seven-day and
   completed-transcription checks plus that exact Mac durability receipt.

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

### Decision: encrypted operation log over `iroh-docs`

Use one Iroh document per Type vault. Trusted devices receive the document's
write capability plus the Type vault root key during pairing. The always-online
sync peer receives only a read capability. It can replicate valid signed entries
and their blobs but cannot create namespace-valid entries.

Neither the Iroh document key nor its blob values are Type plaintext:

- every entry key is a random 32-byte opaque operation id;
- every entry value is a Type encrypted envelope;
- path, filename, object kind, device id, sequence, predecessor, hashes, note
  bytes, and attachment bytes are all inside the envelope;
- `iroh-docs` author signatures authenticate the writing replica, while the
  Type envelope's AEAD prevents a read-only peer from producing valid content;
- the peer still observes namespace id, author public ids, timestamps, opaque
  keys, content hashes, sizes, and connection metadata.

The log contains filesystem operations (`upsert`, `delete`) rather than making
the Iroh document itself the note database. A device applies unseen operations
to Markdown/filesystem state and commits the resulting batch to local Git. If a
remote operation's base hash does not match a concurrently changed local file,
Type preserves both versions using the existing `.conflict.md` behavior.

`iroh-docs` is a useful sync engine here, but it is not a security boundary and
does not make the design automatically production-ready. Type must encrypt
before `set_bytes`, use opaque keys, bound downloads, remember accepted device
sequences, and retain independent backups. The current `iroh-docs` stack also
inherits the pre-production stability boundary of the rewritten
`iroh-blobs` line.

### Delivery slices

1. Define and test the encrypted envelope and per-device sequence state without
   network dependencies.
2. Add an `iroh-docs` client store and a standalone persistent read-only peer;
   prove phone-online → peer → phone-offline → Mac-online in an integration
   test.
3. Publish encrypted Markdown upsert/delete operations and apply them with
   conflict preservation, then make one Git commit per received batch.
4. Move encrypted audio through the document's blob store and issue an encrypted
   Mac durability receipt before the seven-day phone eviction policy can run.
5. Add device revocation, signed receipt chains, rollback warnings, quotas,
   garbage collection, backup/replication, and operational monitoring that
   never logs plaintext or keys.
