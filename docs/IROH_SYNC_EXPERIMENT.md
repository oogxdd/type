# Iroh sync experiment

This experiment keeps the existing Git/SSH sync semantics and replaces only
the network path between a phone and a desktop.

## Transport

- The desktop keeps its existing SSH Git server for LAN compatibility.
- An Iroh endpoint exposes a private byte-stream tunnel and forwards it to the
  SSH server through desktop loopback.
- The pairing QR contains the existing one-time SSH pairing remote plus an
  Iroh endpoint ticket.
- The phone starts a loopback TCP proxy. libgit2 still talks SSH to that proxy;
  the proxy carries the bytes over Iroh to the desktop.
- Recording audio uses a second, hash-verified Iroh stream before Git sync.
  `Recordings/` is then excluded in that device's local Git config, so new
  audio never leaves a hidden blob in the phone's `.git/objects` database.
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
- Manual **Sync now** remains available and exposes errors; automatic attempts
  never block capture or editing.
- iOS and Android background execution is not promised. The reliable triggers
  are foreground/save while the app is active.

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
content-addressed attachment store outside the Git working tree, as described
in `ATTACHMENT_RETENTION.md`.

Recordings that were already tracked by Git before this experiment are kept on
the phone. Removing only their working-tree copy would not release their Git
blob, so migrating old recordings is deliberately deferred rather than
presenting a misleading storage saving. New recordings use the true
out-of-band path.

## Rollout boundary

The Iroh path is additive and can be disabled without changing repository
contents. Existing ordinary Git remotes and LAN SSH pairing continue to work.
