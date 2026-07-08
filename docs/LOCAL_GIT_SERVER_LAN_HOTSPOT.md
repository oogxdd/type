# Local network sync

This page used to document the old local `git://` / `git daemon` flow. Local
sync now uses Type's embedded SSH Git server instead.

Use the current flow:

1. Open **Settings -> Sync** on desktop.
2. Keep the desktop app open; Type starts the local SSH sync server
   automatically.
3. On iPhone, open **Sync -> Scan QR code**.
4. Scan the desktop QR and then tap **Sync now**.

The QR pairs the phone's app-managed SSH key with the desktop, pins the desktop
host key, and saves an `ssh://pair-...@<desktop-ip>:9418/<repo>` remote. macOS
Remote Login and `~/.ssh/authorized_keys` are not required.

For contributor-level architecture details, see [LOCAL_SYNC.md](./LOCAL_SYNC.md).
