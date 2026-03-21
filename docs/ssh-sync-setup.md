# SSH Git Sync Setup

Sync notes between your phone and home machine over SSH using key-based authentication. No extra servers or services required.

## Prerequisites

- macOS on the home machine with **Remote Login** enabled
  (System Settings > General > Sharing > Remote Login)
- Both devices on the same local network (or reachable via Tailscale/WireGuard)

## 1. Generate an SSH key in the app

Go to **Settings > SSH key** and tap **Generate SSH key**.

The app creates an Ed25519 keypair stored in its private data directory. The public key is displayed for you to copy.

## 2. Set up a bare git repo on your Mac

```bash
git init --bare ~/notes-sync.git
```

## 3. Add the public key to your Mac

Copy the public key from the app and append it to `~/.ssh/authorized_keys` on your Mac:

```bash
# Create the file if it doesn't exist
mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys
chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys

# Paste the key (replace the placeholder)
echo "ssh-ed25519 AAAA... type-notes-sync" >> ~/.ssh/authorized_keys
```

## 4. Configure the remote in the app

In **Settings > Git**, set the remote URL:

```
ssh://your-user@your-mac.local/Users/your-user/notes-sync.git
```

- `your-user` is your macOS username
- `your-mac.local` uses mDNS — works on local networks without knowing the IP
- You can also use a static IP like `192.168.1.42` instead

Leave **Username** and **Password** empty — the SSH key handles authentication.

## 5. Sync

Use **Connect**, then **Push** / **Pull** as usual. The app automatically uses the generated SSH key for all git operations.

---

## Restricting SSH access (recommended)

By default, the SSH key grants full shell access to your Mac. You should restrict it to git-only operations.

### Option A: Allow git commands only (any repo)

Prefix the key in `~/.ssh/authorized_keys` with restrictions:

```
command="git-shell -c \"${SSH_ORIGINAL_COMMAND}\"",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... type-notes-sync
```

This allows only git push/pull — no shell access, no tunneling.

### Option B: Lock down to a single repo

Create a wrapper script at `~/git-notes-only.sh`:

```bash
#!/bin/bash
ALLOWED_REPO="/Users/your-user/notes-sync.git"
case "$SSH_ORIGINAL_COMMAND" in
  "git-receive-pack '${ALLOWED_REPO}'"|\
  "git-upload-pack '${ALLOWED_REPO}'")
    eval "$SSH_ORIGINAL_COMMAND"
    ;;
  *)
    echo "Access denied"
    exit 1
    ;;
esac
```

Make it executable:

```bash
chmod +x ~/git-notes-only.sh
```

Then reference it in `~/.ssh/authorized_keys`:

```
command="/Users/your-user/git-notes-only.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... type-notes-sync
```

Even if the private key is compromised, the attacker can only push/pull to that one repo.

### Disable password authentication (optional)

To ensure only key-based login is allowed, edit `/etc/ssh/sshd_config`:

```
PasswordAuthentication no
```

Then restart the SSH service or reboot.

---

## Security notes

- **SSH traffic is encrypted** — safe on any network
- The private key never leaves the device — it stays in the app's sandboxed data directory
- On iOS the key is protected by the app sandbox; on macOS it has `0600` permissions
- If you regenerate the key, you must re-add the new public key to `authorized_keys`

## Troubleshooting

- **"Permission denied"**: Ensure the public key is in `authorized_keys` and the file has `chmod 600`
- **"Connection refused"**: Check that Remote Login is enabled on your Mac
- **Host not found**: Try using the IP address instead of `.local` hostname
- **Key already exists**: Delete the existing key in Settings before generating a new one
