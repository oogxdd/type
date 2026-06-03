# Local network sync — design & architecture

How the app syncs notes between a computer and a phone **without any external
Git host**, over a shared Wi-Fi or the phone's personal hotspot. This document
explains the model, the moving parts, and the trade-offs so the feature is easy
to reason about and extend.

> User-facing setup lives in [../LOCAL_GIT_SERVER_LAN_HOTSPOT.md](../LOCAL_GIT_SERVER_LAN_HOTSPOT.md)
> and the README "Git sync setup" section. This file is for contributors.

---

## 1. The mental model

There is exactly one idea to hold onto:

> **The desktop hosts the repository; the phone is a client. All sync setups
> differ only in the URL the phone connects to.**

The desktop's notes folder is a normal (non-bare) Git working repo. The phone
clones/pulls/pushes against it. We never introduce a separate "server copy" of
the notes — the thing you edit on the desktop *is* the remote the phone talks to.

### The three setups

| # | Setup | Phone's remote URL | Server process | Where it runs |
|---|-------|--------------------|----------------|---------------|
| 1 | Remote repo | `https://…` / `ssh://…` (internet host) | the remote host | off-device |
| 2 | Local SSH (same Wi-Fi) | `ssh://user@<computer-ip>/<path>` | the computer's built-in `sshd` (Remote Login) | OS-level |
| 3 | Local `git://` (Wi-Fi or hotspot) | `git://<computer-ip>/<folder>` | `git daemon`, spawned by the app | in-app button |

Setup 3 is the one this feature adds end-to-end: a single **Start server**
button. Setup 2 is supported by surfacing the ready-to-use `ssh://` URL (the app
can't toggle the OS `sshd`, so the user enables Remote Login once). Setup 1 is
the pre-existing path.

All three are driven by the same client code (`connect` / `pull` / `push` /
`syncNow`) — only the URL changes.

---

## 2. How the local `git://` server works

`Start server` (desktop) supervises a `git daemon` child process. The mechanism,
validated end-to-end:

1. **Ensure a repo with a commit.** `ensure_git_repo` inits the notes folder if
   needed; a best-effort initial commit gives the phone something to clone. An
   empty repo is also fine — the phone can push to create the branch.
2. **Allow pushes into the live working tree.** We set
   `receive.denyCurrentBranch=updateInstead` on the repo. Normally Git refuses a
   push to the branch that is currently checked out; `updateInstead` makes Git
   **also update the working tree** when it is clean. So a push from the phone
   makes the desktop's notes files change on disk immediately. If the desktop has
   uncommitted edits, the push is rejected (push from the desktop first).
3. **Spawn the daemon:**
   ```
   git daemon --reuseaddr --export-all
              --enable=upload-pack --enable=receive-pack
              --base-path=<parent-of-notes> --listen=0.0.0.0 --port=9418
              <parent-of-notes>
   ```
   `--base-path` is the notes folder's **parent**; the served repo name is the
   notes folder's basename, so the URL is `git://<ip>/<basename>`.
4. **Find the address.** `detect_lan_ip()` opens a UDP socket and `connect()`s to
   a few well-known targets (incl. `172.20.10.1`, the iPhone-hotspot gateway).
   `connect` does a route lookup and exposes the source IP for that route without
   sending packets — that source IP is exactly what the phone must dial. Works on
   shared Wi-Fi and on hotspot.
5. **Lifecycle.** The `Child` handle lives in a process-global `Mutex<Option<…>>`.
   Start is idempotent (returns the running status if already up); a dead handle
   is reaped. Stop kills the child; the app also kills it on `RunEvent::Exit`.

### Why `git daemon` and not a pure-Rust server

`git daemon` is battle-tested and ships with Git. The client side intentionally
uses `libgit2` (no shell Git needed), but the **server** role is desktop-only and
relies on the `git` binary. If it's missing the app says so
(`xcode-select --install` on macOS). Re-implementing the smart-HTTP/`git://`
protocol in Rust would buy nothing here.

---

## 3. Discovery & handoff (so the phone doesn't have to type a URL)

First-time setup needs the phone to learn the desktop's URL. Three ways, in order
of convenience:

- **mDNS auto-discovery (tap-only).** When the server starts, the desktop
  advertises a Bonjour service `_typenotes-sync._tcp.local.` on port 9418 with
  TXT records (the repo name, branch, and full `git://` URL). The phone browses
  for that service and lists what it finds; tapping an entry fills the remote URL
  and syncs. No typing, no scanning.
- **QR code (tap-only, survives multicast-blocked networks).** The desktop card
  renders a QR encoding a `type2://sync?...` deep link. The user points the
  **native iOS Camera** at it; iOS opens the app via the existing deep-link
  handler, which applies the settings and syncs. Native camera scanning is
  reliable and needs no in-webview camera access.
- **Manual.** Copy the URL from the desktop card and paste it into the phone's
  Remote URL field once.

mDNS and QR carry the same payload (a `git://` URL + branch + name); they are
just two transports for it. See §6 for the deep-link format.

---

## 4. The `syncNow` orchestration

One tap should "just sync", regardless of which side changed. `syncNow`
(`GitSyncContext`) composes the existing primitives:

1. **Connect** if the repo isn't wired up yet.
2. **Push** local work first. This commits local edits, so the working tree is
   clean afterward — *even if the network push is rejected* (the commit happens
   before the push). A non-fast-forward rejection here is expected when the other
   device pushed since last time, so it's swallowed.
3. **Pull / merge** the remote. Safe now because the tree is clean. Conflicts on
   the same file never block: the local version is kept and the remote version is
   written as a `.conflict.md` sibling.
4. **Push** the merged result.

This ordering is what lets a single button reconcile bidirectional edits with the
app's pull-refuses-dirty-tree / push-commits-then-pushes primitives.

---

## 5. Code map

```
src-tauri/src/
  ports/local_sync.rs      contract: LocalSyncServerStatus + LocalSyncServer trait + docs
  adapters/local_sync.rs   git daemon supervisor, IP detection, mDNS advertise/browse
  commands/local_sync.rs   #[tauri::command] wrappers (start/stop/status/discover)

src/
  data/gitApi.ts                              invoke wrappers + types
  contexts/GitSyncContext.tsx                 syncNow orchestration
  components/settings/LocalSyncServerCard.tsx desktop host card (Start/Stop, URLs, QR)
  mobile/components/settings/MobileSyncSection.tsx  Sync now + discovery list
  mobile/MobileShell.tsx                      type2://sync deep-link handler
```

The `ports/` layer is a platform-agnostic contract (documented in the same house
style as `git_sync`); `adapters/` holds the real Tauri/Rust implementation.

---

## 6. Deep-link format

```
type2://sync?remote=<url-encoded git:// or ssh:// URL>&branch=<branch>&name=<label>
```

- `remote` (required) — the remote URL to store as `gitRemoteUrl`.
- `branch` (optional, default `main`) — stored as `gitBranch`.
- `name` (optional) — human label for confirmation UI.

The handler in `MobileShell` parses this, applies the settings to the active
profile, and triggers `syncNow`.

---

## 7. Security model

- `git://` is **plaintext and unauthenticated**. It is intended for trusted local
  networks (your home Wi-Fi, your own phone's hotspot) only — never the open
  internet. The daemon binds `0.0.0.0`, so anything on the same network segment
  that can reach port 9418 can read/write the notes while it runs. Stop the
  server when you're done.
- For untrusted networks use **setup 2 (`ssh://`)**: enable Remote Login, add the
  app's generated SSH key to `~/.ssh/authorized_keys`, and use the `ssh://` URL.
- macOS will show a firewall prompt the first time the daemon binds; allow it.

---

## 8. Known limitations / future work

- **Hosting needs the `git` CLI** on the desktop (client still uses libgit2).
- **iOS local-network permission.** Browsing mDNS and connecting to a LAN peer
  triggers iOS's Local Network permission prompt (and requires the
  `NSLocalNetworkUsageDescription` / `NSBonjourServices` Info.plist keys, which
  this feature adds). Raw multicast on iOS can additionally require the
  `com.apple.developer.networking.multicast` entitlement (Apple-gated); if mDNS
  discovery is blocked, QR and manual entry still work.
- **Folder names with spaces** don't make clean `git://` paths; use the `ssh://`
  route for those.
- **No zero-config security.** Pairing is trust-on-first-use; there's no
  device-to-device key exchange. A future step could pin the desktop's SSH host
  key via the QR/mDNS payload and default to `ssh://`.
