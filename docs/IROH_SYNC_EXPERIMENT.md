# Iroh sync experiment

This experiment keeps the existing Git/SSH sync semantics and replaces only
the network path between a phone and a desktop.

For a less implementation-heavy explanation of how Git, SSH, Iroh, direct
paths, relays, and the sync logs fit together, see
[`IROH_SYNC_MENTAL_MODEL.md`](./IROH_SYNC_MENTAL_MODEL.md).

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
- SSH host-key pinning and the existing paired-device allowlist remain the Git
  authentication boundary. During QR setup the same one-time token also binds
  the phone's authenticated Iroh Endpoint ID into a desktop allowlist; audio
  offers from any other Endpoint ID are rejected before a blob is fetched.
  Iroh relays are transport only and do not store the notes repository.
- One QR scan pairs both transports, and whichever half lands first rotates the
  token out from under the other. Iroh authorization therefore shares the SSH
  server's list of recently retired tokens (`consumed_pairing_tokens`, a
  five-minute grace) rather than keeping a second store of its own. An empty
  token is a *check*, not a pairing attempt: the phone sends one on every sync
  so its Sync screen can report audio pairing long after the QR token is gone.

The first version deliberately does not replace Git with `iroh-docs` or a new
merge model. That keeps note conflicts, history, backup, and rollback behavior
unchanged while making the transport testable independently.

## Connection rules

Three rules are load-bearing. Breaking any of them produces failures that look
like network flakiness — they were the cause of "the desktop did not
acknowledge Iroh pairing: connection lost" and of intermittently truncated
syncs.

1. **A handler must not return while the peer still needs the connection.**
   iroh's `Router` drops the `Connection` the moment `ProtocolHandler::accept`
   returns, and a dropped QUIC connection discards anything it has not had
   acknowledged — `SendStream::finish` only marks the end of the stream, it does
   not wait for delivery. So `serve_iroh_connection` loops on `accept_bi()`
   until the peer closes, spawning a task per stream, rather than replying and
   returning. iroh's own echo example makes the same point with
   `connection.closed().await`.
2. **The phone keeps one connection per computer.** Git tunnel streams, the
   pairing check, and audio offers are all streams on it. Besides removing a
   QUIC handshake per libgit2 connection, this means no reply can ever race a
   teardown: the connection outlives every individual exchange.
3. **The endpoint ticket is a snapshot; the endpoint id is not.** A ticket minted
   at server start carries the addresses of that moment, and
   `Endpoint::connect` only falls back to address lookup when the address it was
   given has no relay URL — so a stale relay actively blocks discovery. The
   desktop therefore recomputes its ticket on every status poll (the QR updates
   itself), and the phone dials the ticket's addresses first and then retries
   with the bare `EndpointId`, which `presets::N0` publishes to n0's pkarr/DNS.

Waiting for a relay is never a precondition for hosting. It used to be: a slow
first relay handshake produced a QR with no Iroh ticket at all, silently
downgrading the phone to a LAN address that stopped working the moment it left
the network. The server now returns as soon as its socket is bound and attaches
the relay in the background.

`crates/type-core/src/adapters/iroh_sync.rs` covers rules 1 and 2 with tests
that run two endpoints in-process over loopback. They assert the invariant (one
connection serves several streams) rather than delivery of a single reply —
over loopback the racing close nearly always loses, so a delivery assertion
would pass against the broken code.

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
- **Audio pairing failing never fails a sync.** Only recordings need the Iroh
  authorization; notes go through the SSH tunnel either way. A phone the desktop
  has not authorized keeps carrying its audio inside Git — the pre-Iroh
  behavior — rather than excluding it and uploading nothing. The phone reports
  this in its Sync screen instead of turning it into a sync error.
- The phone's **Direct connection** panel reports which computer it dials,
  whether the last connection ran direct or through a relay, whether audio
  transfer is paired, and the last transport failure. When the transport is what
  broke, the phone shows that instead of libgit2's message about a loopback
  port, which named the wrong problem entirely.
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
