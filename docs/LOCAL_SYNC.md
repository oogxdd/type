# Local network sync

How Type syncs notes between desktop and phone without an external Git host.

## Model

The desktop hosts the active notes root as a normal non-bare Git repository. The
phone is a Git client. Pulls and pushes go directly against the desktop's live
working tree, so there is no separate server copy of the notes.

There are three supported sync shapes:

| Setup | Remote URL | Server |
| --- | --- | --- |
| Internet remote | `https://...` / `ssh://...` | GitHub, Gitea, another Git host |
| Local network | `ssh://pair-<token>@<desktop-ip>:9418/<repo>` | Type's embedded SSH Git server |
| Iroh direct/relay | Phone loopback SSH URL plus an Iroh ticket | Iroh tunnel to the same embedded SSH server |

The Iroh path and separate audio transfer are described in
[IROH_SYNC_EXPERIMENT.md](IROH_SYNC_EXPERIMENT.md). The LAN addresses below
describe the direct SSH path.

The old local `git://` daemon flow has been replaced by embedded SSH. The local
flow no longer requires macOS Remote Login, `sshd`, or editing
`~/.ssh/authorized_keys`.

## Desktop Server

Opening **Settings -> Sync** starts the local server automatically when Git is
available. The server:

1. Ensures the active notes root is a Git repo.
2. Sets `receive.denyCurrentBranch=updateInstead`, so phone pushes update the
   checked-out desktop working tree when it is clean.
3. Creates or reuses an Ed25519 host key under app data.
4. Starts an embedded SSH server on `0.0.0.0:9418`.
5. Executes the desktop `git` binary as `git-upload-pack` or
   `git-receive-pack` for each SSH exec request.

Starting the server never commits anything (so the settings page's auto-start
has no side effects). Instead, pending desktop edits are committed right before
each serve — a phone pull always sees the desktop's latest notes, and a phone
push never meets a dirty working tree.

The server also advertises itself over mDNS (`_typenotes-sync._tcp`) for future
discovery UI. The advertised URL deliberately **omits the pairing token** —
mDNS is plaintext broadcast; the token travels only inside the QR code.

Port `9418` is intentionally retained from the previous local-sync design so
existing firewall prompts/rules still make sense, but the protocol on that port
is now SSH, not `git://`.

## Pairing

The desktop card builds a `type2://sync` QR deep link containing:

```
remote=ssh://pair-<token>@<desktop-ip>:9418/<repo>
branch=<branch>
name=<desktop label>
hostKeySha256=SHA256:<fingerprint>
```

When the phone scans the QR:

1. It generates the app-managed SSH key if one does not exist.
2. It stores the remote URL and the desktop host-key fingerprint in the active
   profile settings.
3. It connects with username `pair-<token>` and its public key.
4. The desktop accepts an unknown key only when the username matches the current
   pairing token, then stores the phone key in app data as an authorized device.

After pairing, the phone saves a durable remote URL with the pairing username
removed. Known keys are accepted regardless of username, so legacy saved URLs
that still contain a token also survive server restarts.

## Host-Key Verification

The QR carries the desktop host-key fingerprint. The mobile/core Git callbacks
only auto-accept an SSH host key when:

- the remote hostname matches the saved trusted host, and
- the presented SHA-256 host-key fingerprint matches the saved QR fingerprint.

When no pin applies and the host is on the local network (private IP or
`.local`), the key is trusted on first use — manual setup has no fingerprint to
pin, and phones carry no `known_hosts`, so strict checking would reject every
LAN server. Internet SSH remotes keep normal libgit2/SSH host-key behavior.

## Failure Behavior

Before libgit2 fetches or pushes, the core does a short TCP probe of network
remotes. LAN failures return quickly with messages such as:

- connection timed out,
- connection refused,
- host/network unreachable.

The mobile UI maps those errors to local-sync guidance: keep Type open on the
desktop, stay on the same Wi-Fi or hotspot, and allow Local Network access in
iOS Settings. A leftover `git://<lan-ip>/...` remote from the pre-SSH design is
rejected up front with a prompt to re-scan the QR code.

## Sync ordering and offline edits

The phone owns one complete pull → push workflow at a time. Concurrent Sync now
calls join the existing operation; status refreshes cannot interrupt it. Audio
transfer and cache maintenance follow the notes push without delaying it.

The core fetches from the real peer before committing pending local edits for a
pull. A standalone push authenticates before committing and reuses that connection
for transmission. An unreachable desktop therefore does not create a new commit
for each offline save. Manual checkpoints still work offline. A later transfer
failure can leave a local commit, so successful syncs are not guaranteed to map
to exactly one commit.

A successful TCP probe of an Iroh loopback proxy only proves the phone proxy is
listening; it does not establish desktop availability. Native timings distinguish
fetch, push authentication, local commit, and total push duration. Mobile timings
also identify status/history reads, note refresh, and cache maintenance.

For recording storage and the seven-day phone policy, see
[Attachment retention](ATTACHMENT_RETENTION.md). To remove old audio from Git
while preserving text history, follow [Audio history migration](AUDIO_HISTORY_MIGRATION.md).

## Device-Local Settings

`.type/settings.json` is a tracked file that syncs with the notes (that is
intentional — `transcription_mode` is a per-folder setting shared by devices).
The git connection, however, is per device: remote URL, branch, credentials,
and the pinned host-key fingerprint live in `.type/device.json`, which is kept
out of sync via `.git/info/exclude` (written by `ensure_git_repo`). Legacy
settings files that still carry git fields keep working until the first save
migrates them.

## Code Map

```
crates/type-core/src/adapters/local_sync/
  mod.rs          server lifecycle, LAN IP detection, mDNS advertisement
  ssh_server.rs   russh server, public-key pairing, git upload/receive exec
  devices.rs      desktop host key + paired phone key store

crates/type-core/src/adapters/git/mod.rs
  libgit2 sync, SSH credentials, host-key pinning, fast TCP probe

packages/shared/src/sync-link.ts
  type2://sync deep-link builder/parser

apps/desktop/src/features/sync/components/local-sync-server-card.tsx
  desktop QR and local server controls

apps/mobile/src/state/sync-store.ts
apps/mobile/src/screens/sync-screen.tsx
  QR apply flow, key generation, visible connect/pull/push states
```
