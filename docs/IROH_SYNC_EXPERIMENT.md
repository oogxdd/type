# Iroh sync experiment

This experiment keeps the existing Git/SSH sync semantics and replaces only
the network path between a phone and a desktop.

## Version and stability boundary

- Type pins Rust `1.97.1` in `rust-toolchain.toml`; the workspace manifests,
  CI, desktop release, and iOS codegen all use that same toolchain.
- The transport uses stable `iroh 1.0.3` and `iroh-tickets 1.0.0`.
- The compatible blob protocol is `iroh-blobs 0.103.0`. Upstream explicitly
  labels this rewritten line as not yet production quality and recommends
  `0.35` for production blob workloads. Type accepts that risk only for this
  opt-in experiment so the transport itself is not built on the legacy Iroh
  wire protocol. Keep the adapter boundary and exact version pin until the
  blob crate reaches its own stable release.
- The rewritten blob store uses versioned `*-blobs-v103` cache directories.
  It never opens or mutates a cache created by `iroh-blobs 0.35`.
- Iroh 0.35 and 1.x peers are not wire-compatible. After upgrading both apps,
  pair the phone again so it receives a new endpoint ticket.

## Transport

- The desktop keeps its existing SSH Git server for LAN compatibility.
- An Iroh endpoint exposes a private byte-stream tunnel and forwards it to the
  SSH server through desktop loopback.
- The pairing QR contains the existing one-time SSH pairing remote plus an
  Iroh endpoint ticket.
- The phone starts a loopback TCP proxy. libgit2 still talks SSH to that proxy;
  the proxy carries the bytes over Iroh to the desktop.
- Recording audio is imported into a persistent `iroh-blobs` store and offered
  to the desktop by BLAKE3 `BlobTicket`. Type's small control stream carries
  only the destination path, SHA-256 retention identity, blob ticket, and
  acknowledgement. `iroh-blobs` performs verified, resumable transfer.
  `Recordings/` is excluded in that device's local Git config, so new audio
  never leaves a hidden blob in the phone's `.git/objects` database.
- SSH host-key pinning and the existing paired-device allowlist remain the
  authentication boundary. Iroh relays are transport only and do not store the
  notes repository.

The first version deliberately does not replace Git with `iroh-docs` or a new
merge model. That keeps note conflicts, history, backup, and rollback behavior
unchanged while making the transport testable independently.

## User experience under test

- Pair once by scanning the desktop QR. Same-Wi-Fi is not required.
- A save schedules a best-effort sync after the editor has flushed the note.
- Returning the app to the foreground schedules another best-effort sync.
- A failed automatic attempt retries after 2s, 5s, 10s, 30s, 60s, and then
  every five minutes while the mobile process remains active. A new save or
  foreground event resets the backoff.
- Manual **Sync now** remains available and exposes errors; automatic attempts
  never block capture or editing. Manual sync uses the same pull → audio blob
  transfer → push path and retains visible object/byte progress.
- Capture and menu surfaces show `Saved locally`, `Waiting for computer`,
  `Syncing…`, or `Synced` without turning an offline Mac into an error dialog.
- iOS and Android background execution is not promised. The reliable triggers
  are foreground/save while the app is active.

On macOS, closing the main window hides it and leaves the Type process and
direct-sync endpoint running. Reopening Type from the Dock restores the window;
**Quit Type** still stops the endpoint. This provides the intended no-window
workflow without introducing a second process that could concurrently mutate
the same Git working tree. A true launch-at-login helper is a later packaging
step and must own the server exclusively behind IPC rather than starting a
second independent server.

## Mobile audio retention

Audio removal is a device-local cache policy, not a synced Git deletion.
A phone may evict an audio file only when all of these are true:

1. The recording is at least seven days old.
2. Its transcription status is complete.
3. The desktop has received the out-of-band Iroh upload and then issued a
   durability receipt for the exact audio content hash.

The Markdown recording note and transcript remain on the phone. Opening an
evicted attachment shows that the audio is archived on the desktop; it must not
look like corruption. Pending, failed, untranscribed, or unacknowledged audio
is never evicted.

For this experiment, durability receipts are tracked metadata under `.type/`
so the phone receives them through Git. Cache state is device-local metadata
under `.type/` and is excluded from Git. The long-term design remains a
content-addressed attachment store outside the Git working tree. That layer is
now `iroh-blobs`; receipts and the seven-day cache policy remain Type-specific
because blob transfer alone cannot decide whether a desktop copy is durable
enough to delete the phone copy.

Recordings that were already tracked by Git before this experiment are kept on
the phone. Removing only their working-tree copy would not release their Git
blob, so migrating old recordings is deliberately deferred rather than
presenting a misleading storage saving. New recordings use the true
out-of-band path.

## Rollout boundary

The Iroh path is additive and can be disabled without changing repository
contents. Existing ordinary Git remotes and LAN SSH pairing continue to work.

Future optional directions are documented separately:

- `architecture/10-zero-knowledge-sync-peer.md` — an untrusted persistent
  mailbox that stores only client-encrypted objects.
- `architecture/11-filesystem-sync-without-git.md` — retaining Markdown and
  folders while replacing Git commits with a file-operation journal.
