# Local network sync

How Type syncs notes between desktop and phone without an external Git host.

## Model

The desktop hosts the active notes root as a normal non-bare Git repository. The
phone is a Git client. Pulls and pushes go directly against the desktop's live
working tree, so there is no separate server copy of the notes.

There are two supported sync shapes:

| Setup | Remote URL | Server |
| --- | --- | --- |
| Internet remote | `https://...` / `ssh://...` | GitHub, Gitea, another Git host |
| Local network | `ssh://pair-<token>@<desktop-ip>:9418/<repo>` | Type's embedded SSH Git server |

The old local `git://` daemon flow has been replaced by embedded SSH. The local
flow no longer requires macOS Remote Login, `sshd`, or editing
`~/.ssh/authorized_keys`.

## Desktop daemons

Local sync uses two mutually exclusive processes on the same port:

- The lightweight **request daemon** starts while the desktop app is open and
  unlocked when **Ask before syncing** is enabled. It authenticates paired keys,
  emits approval requests, and advertises mDNS. It has no Git binary or repo
  handle and cannot serve notes.
- The temporary **Git server** replaces the request daemon after desktop
  approval, or when the user opens a pairing window. It:

1. Ensures the active notes root is a Git repo.
2. Sets `receive.denyCurrentBranch=updateInstead`, so phone pushes update the
   checked-out desktop working tree when it is clean.
3. Creates or reuses an Ed25519 host key under app data.
4. Starts an embedded SSH server on `0.0.0.0:9418`.
5. Executes the desktop `git` binary as `git-upload-pack` or
   `git-receive-pack` for each SSH exec request.

Starting the request daemon does not initialize or inspect the repository.
Starting the Git server never commits anything. Instead, pending desktop edits
are committed right before each serve — a phone pull always sees the desktop's
latest notes, and a phone push never meets a dirty working tree.

The server also advertises itself over mDNS (`_typenotes-sync._tcp`) so paired
phones can find it when its LAN address changes. The advertised URL deliberately
**omits the pairing token** — mDNS is plaintext broadcast; the token travels
only inside the QR code. The host-key fingerprint is advertised so the phone
can match a discovered listener to its existing pinned pairing.

Both daemons use the same Ed25519 host identity and take turns owning port
`9418`. The request daemon releases the socket before the Git server binds it,
so the phone keeps retrying its saved URL through the handoff. Port `9418` is
intentionally retained from the previous local-sync design so existing firewall
prompts/rules still make sense, but the protocol is SSH, not `git://`.

## Pairing

The user clicks **Pair a phone** to open a temporary Git/pairing window. The
desktop card then builds a `type2://sync` QR deep link containing:

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

After pairing, the saved remote URL can keep the old token username. Known keys
are accepted regardless of username, so server restarts do not break paired
devices.

## Approval windows

When **Ask before syncing** is enabled, only the request daemon and mDNS
advertisement remain available between syncs. Only an already-paired SSH key can
create a request. The desktop emits a global prompt with the paired device name:

1. The phone starts its normal pull and receives
   `TYPE_SYNC_APPROVAL_REQUIRED` from the request-only listener.
2. The phone waits and retries instead of showing a transport failure.
3. Accepting stops the request daemon and starts the Git server on the same
   port; the next retry continues pull and push automatically. A brief connection
   failure during this handoff is retried. Declining returns
   `TYPE_SYNC_APPROVAL_DECLINED` and the phone stops retrying.

The Git server shuts down after the configured 5, 10, or 15 minutes without a
completed Git operation. Every successful fetch or push restarts the timer. If
approval mode is enabled, the request daemon takes the port back; otherwise
local sync stops completely. **Stop listener** shuts down SSH and mDNS.

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
  request_server.rs paired-key approval requests; no Git/repo access
  ssh_server.rs   russh server, public-key pairing, git upload/receive exec
  devices.rs      desktop host key + paired phone key store

crates/type-core/src/adapters/git/mod.rs
  libgit2 sync, SSH credentials, host-key pinning, fast TCP probe

packages/shared/src/sync-link.ts
  type2://sync deep-link builder/parser

crates/type-ffi/src/local_sync.rs
packages/mobile-core/src/{raw-core,core-api}.ts
  mobile mDNS discovery bridge

apps/desktop/src/features/sync/components/local-sync-lifecycle.tsx
apps/desktop/src/features/sync/components/local-sync-server-card.tsx
  app-wide approval prompt, QR, preferences, and server controls

apps/mobile/src/lib/sync-approval.ts
apps/mobile/src/state/sync-store.ts
apps/mobile/src/screens/sync-screen.tsx
  discovery, approval retry, QR apply, and visible sync states
```
