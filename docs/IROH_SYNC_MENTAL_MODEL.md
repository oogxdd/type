# How Iroh sync, SSH, and Git fit together

Type still uses Git over SSH to synchronize notes. Iroh does not replace Git
or SSH. It replaces the network path that the SSH connection travels through,
allowing a phone to reach a laptop when they are not on the same local network.

The shortest description of the design is:

> Type uses the Git smart protocol over SSH, tunnelled over an Iroh/QUIC
> connection. The laptop acts as a self-hosted Git remote.

## The connection, layer by layer

```text
Phone Git client (libgit2)
    |
    | SSH to 127.0.0.1:19418
    v
Phone's local Type/Iroh proxy
    |
    | Iroh over QUIC
    |   - direct peer-to-peer path when possible
    |   - n0 relay when a direct path is unavailable
    v
Laptop's Iroh endpoint
    |
    | forwards the original SSH bytes to 127.0.0.1:9418
    v
Type's embedded SSH server
    |
    | starts git-upload-pack or git-receive-pack
    v
Laptop's notes repository
```

From Git's point of view, this is still an ordinary SSH remote. On the phone,
Type rewrites the saved laptop SSH address to the phone's loopback proxy at
`127.0.0.1:19418`. The proxy opens an Iroh stream and copies the SSH bytes into
it. On the laptop, Type copies those bytes from the Iroh stream to the embedded
SSH server listening on loopback at `127.0.0.1:9418`.

Neither Git nor the SSH implementation needs to understand Iroh. The SSH
handshake and public-key authentication still happen between the phone's Git
client and the laptop's embedded SSH server. Iroh is an outer encrypted
transport carrying that connection, so describing this as **SSH over Iroh** or
an **SSH-over-Iroh tunnel** is accurate.

## What changed from LAN-only sync

Before Iroh, the phone connected directly to the laptop's LAN address:

```text
Phone Git -> SSH -> 192.168.x.x:9418 -> laptop
```

That requires the phone to be able to route to the laptop, normally by being on
the same Wi-Fi network or hotspot.

With Iroh, the phone connects to an Iroh endpoint identity instead of depending
on the laptop's private LAN address:

```text
Phone Git -> SSH -> Iroh tunnel -> laptop SSH server
```

Iroh first tries to establish a direct peer-to-peer QUIC path using NAT
traversal. If that is not possible, it carries the traffic through an n0 relay.
This is why a laptop on Wi-Fi and a phone on mobile data can still synchronize.

A message such as:

```text
[iroh-sync] desktop endpoint ... reachable via https://euc1-1.relay.n0.iroh.link./
```

means that the laptop has attached to that relay and can be reached through it.
It does not by itself prove that every transfer used the relay: Iroh may select
or later upgrade to a direct path. Type records the selected path as `direct`,
`relay`, or `unknown` in the phone's connection status.

The relay transports encrypted traffic. It is not the Git server and does not
store the notes repository.

## What Git is doing

The appropriate Git term is **Git smart protocol over SSH**. In this setup:

- The laptop is a **self-hosted Git remote** or **Git server**.
- The laptop repository is **non-bare**, because it is also the live working
  folder used by the desktop app.
- `git-upload-pack` runs on the laptop when the phone fetches or pulls.
- `git-receive-pack` runs on the laptop when the phone pushes.

The names are from the server's perspective:

- `upload-pack`: the server uploads Git objects to the phone.
- `receive-pack`: the server receives Git objects from the phone.

One user-visible sync can create several SSH sessions and therefore several
server log sequences. For example, Type may fetch, transfer audio, push, and
fetch again as part of one synchronization workflow.

These lines show that the SSH connection reached the embedded server and that
the Git operation completed successfully:

```text
[local-sync] auth ok: paired device key (...) as 'git'
[local-sync] serving upload-pack for '/notes'
[local-sync] git process finished with exit code 0
```

Exit code `0` means that particular Git process succeeded.

## Understanding an Iroh timeout after a sync

The phone keeps one reusable Iroh/QUIC connection to the laptop. Pairing
checks, individual SSH tunnels, and audio-control exchanges use separate QUIC
streams multiplexed over that connection.

After the work is finished, the outer connection may remain idle. If the phone
is backgrounded, its network changes, the operating system suspends it, or the
connection is simply inactive long enough, the laptop can log:

```text
[iroh-sync] desktop connection from <phone-endpoint-id> ended: timed out
```

This says that the reusable **Iroh connection** expired. It does not
retroactively mean that a completed Git operation failed. If the log already
contains `git process finished with exit code 0`, that operation succeeded.
The phone will establish a new Iroh connection when it next needs to sync.

A timeout matters when it occurs during a transfer and the phone reports a
failed sync, or when it is accompanied by messages such as `desktop stream ...
failed` or `phone tunnel ... failed`. By itself, after successful Git exit
codes, it is normal connection cleanup expressed as a noisy log message.

The long hexadecimal value in `desktop connection from ...` is the phone's
Iroh endpoint ID. It identifies the Iroh peer; it is not an IP address, an SSH
key, or a Git commit.

## Audio takes a separate data path

Markdown notes, front matter, transcripts, and ordinary Git history travel
through Git-over-SSH-over-Iroh.

New recording audio can instead travel through `iroh-blobs`, outside Git. Type
uses a small control stream to offer the destination path and content hashes,
then the laptop retrieves and verifies the blob. This avoids putting large new
audio files into Git's object database. The log:

```text
[iroh-sync] audio transfer authorized for <phone-endpoint-id>
```

means the laptop recognizes that Iroh endpoint as an authorized phone for this
out-of-band audio path. It does not mean that an audio file was necessarily
transferred at that moment.

If audio authorization is unavailable, note synchronization can still proceed.
The Git/SSH authentication boundary and the Iroh audio authorization are
related through QR pairing but serve different purposes.

## Vocabulary cheat sheet

| Term | Meaning in Type |
| --- | --- |
| Git | Determines commits, history, fetch/push behavior, and merge semantics. |
| Git smart protocol | The Git object-negotiation protocol used by fetch and push. |
| SSH | Authenticates the paired phone and securely carries the Git protocol. |
| Iroh | Provides an identity-addressed path between phone and laptop. |
| QUIC | The transport used by the Iroh connection and its multiplexed streams. |
| Direct path | Peer-to-peer Iroh traffic after NAT traversal succeeds. |
| Relay path | Encrypted Iroh traffic forwarded through an n0 relay. |
| Loopback proxy | The phone-local TCP endpoint that makes Iroh look like an SSH server to libgit2. |
| Embedded SSH server | The SSH server inside the desktop Type process. |
| `git-upload-pack` | Laptop-side Git service used by phone fetch/pull. |
| `git-receive-pack` | Laptop-side Git service used by phone push. |
| Iroh endpoint ID | Cryptographic identity of an Iroh peer, not a network address. |

