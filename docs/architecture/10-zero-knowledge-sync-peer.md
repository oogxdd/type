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

1. Define and fuzz-test the encrypted envelope format independently of Iroh.
2. Implement a local fake mailbox and end-to-end offline-device tests.
3. Upload encrypted Git bundles and encrypted `iroh-blobs` audio objects.
4. Add signed cursors, receipt chains, quotas, and garbage collection.
5. Deploy a single-user peer, then add backup/replication and operational
   monitoring that never logs plaintext or keys.

A true macOS launch-at-login helper should be introduced with the same rule:
one process exclusively owns the embedded Git/Iroh server. The GUI queries and
controls it over a local authenticated IPC socket. Running an independent GUI
server and helper against the same working tree is not safe.
