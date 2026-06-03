# Local Git Server (LAN / iPhone Hotspot)

Sync your notes between this computer and your phone over your local network — no
internet, no external Git host. Works on the same Wi-Fi, or with your computer
connected to your **phone's personal hotspot**.

## Easiest way: the in-app button (recommended)

The desktop app can host the server for you. No terminal needed.

**On the computer (desktop app):**

1. Open **Settings → Sync → Local network server**.
2. Click **Start server**. The app shows a **QR code** and a ready-to-paste
   address, e.g. `git://192.168.1.15/notes`.

**On the phone — pick whichever is easiest (no typing):**

- **Find it automatically.** Settings → Sync → **Find on local network**, then
  tap your computer. (Uses Bonjour/mDNS; allow the local-network prompt.)
- **Scan the QR.** Point your phone's **Camera** at the QR on the computer; it
  opens the app and syncs.
- **By hand.** Settings → Profile → Git: paste the **Remote URL**, set **Branch**
  to `main`, **Apply**, then Settings → Sync → **Sync now**.

That's it. Tap **Sync now** on either device whenever you want to sync. Pushes
from the phone update the computer's notes in place (the repo is configured with
`receive.denyCurrentBranch=updateInstead`).

Notes:

- Hosting is desktop-only and needs the Git command-line tools. On macOS, if the
  app says they're missing, run `xcode-select --install` and try again.
- Keep the desktop app open while syncing; **Stop server** (or quitting the app)
  shuts the server down.
- If the app can't auto-detect your IP, open System Settings → Network and use
  `git://<your-ip>/<notes-folder-name>`.

## More secure option: SSH on the same network

`git://` is plaintext and unauthenticated (fine for a trusted home network /
hotspot). For an authenticated transport, enable **Remote Login** on the Mac
(System Settings → General → Sharing), add the app's SSH key to
`~/.ssh/authorized_keys` (Settings → SSH key → Generate), and use the `ssh://`
URL the server card shows instead.

---

## Manual setup (under the hood / advanced)

The steps below are what the **Start server** button automates. Use them only if
you want to run the server yourself from a terminal.

## 1. Create a bare repository on your computer

```bash
mkdir -p ~/git-remote
cd ~/git-remote
git init --bare notes.git
```

Your remote URL path will be `notes.git`.

## 2. Run `git daemon` with push enabled

From the same parent directory (`~/git-remote`):

```bash
git daemon \
  --verbose \
  --export-all \
  --enable=receive-pack \
  --reuseaddr \
  --base-path=. \
  --listen=0.0.0.0 \
  --port=9418
```

- Keep this terminal running while syncing.
- `--enable=receive-pack` is required for push.

## 3. Find your computer IP on the active network

Use whichever interface is currently connected:

```bash
ipconfig getifaddr en0
ipconfig getifaddr en1
```

If your computer is connected to iPhone hotspot, use the IP from that hotspot interface.

## 4. Configure the app

In **Settings -> Profile**:

- Remote URL: `git://<computer-ip>/notes.git`
- Branch: `main` (or your branch)
- Username/password: usually empty for `git://`

Then in **Settings -> Sync**:

1. Connect
2. Pull (for existing remote data) or Push (for first upload)

## 5. Firewall / network checks

- Allow inbound TCP port `9418` on your computer firewall.
- Ensure iPhone and computer are on the same network:
  - Same Wi-Fi LAN, or
  - iPhone hotspot with computer connected to that hotspot.
- Some networks block peer-to-peer traffic; if pull/push fails immediately, test on another network.

## 6. iPhone hotspot notes

Yes, LAN sync can work when your computer uses iPhone hotspot.

Requirements:
- iPhone app and computer must be on the same hotspot network.
- Computer IP must be reachable from iPhone.
- Port `9418` must be open on computer firewall.

## 7. Daily sync flow

1. Start `git daemon` on computer
2. Pull
3. Edit notes
4. Push

## 8. Troubleshooting

- `Repository is not initialized`:
  - Run Connect first in app.
- `couldn't find remote ref`:
  - Branch name mismatch; verify branch in settings.
- Connection timeout / refused:
  - Check IP, daemon running, and firewall port 9418.
- Push rejected:
  - Confirm daemon started with `--enable=receive-pack`.

## 9. Security note

`git://` is plaintext and unauthenticated. It is okay for trusted local networks but not for internet exposure.

If you need secure remote/off-LAN access, use an authenticated transport (`ssh://` or `https://`) and a secure overlay like Tailscale.
