# Apple Notes Viewer

Local markdown notes app with filesystem storage and optional Git sync. Runs on desktop and iOS via Tauri v2.

## Features

- **Folder tree** with drag-and-drop reordering
- **Markdown editor** (Tiptap) with debounced autosave
- **Git sync** — push/pull notes across devices using any Git remote
- **SSH key auth** — generate Ed25519 keypair in-app for passwordless SSH sync
- **Conflict resolution** — merge conflicts save both versions as sibling files, sync is never blocked
- **Audio recording + transcription** — local Whisper on desktop, AssemblyAI on mobile
- **Multi-profile** — separate notes folders with independent sync settings
- **Desktop** — three-pane layout with keyboard shortcuts
- **Mobile** — native-feeling stack navigation, swipe actions, pull-to-refresh

## Getting started

```bash
npm install
npm run dev          # desktop dev
```

### iOS

```bash
npm run tauri ios init   # one-time
npm run tauri ios dev    # simulator/device
npm run tauri ios build  # release
```

## OTA updates (iOS WebView assets)

This app is configured to use `@inkibra/tauri-plugin-ota` for iOS OTA web asset updates.

Set the OTA manifest URL in your environment:

```bash
cp .env.example .env
# then set VITE_OTA_MANIFEST_URL
```

Build now emits both:

- regular web assets for `index.html`
- deterministic OTA fallback assets: `dist/app.js` and `dist/app.css`

To prepare publishable OTA artifacts + manifest:

```bash
OTA_CDN_BASE_URL=https://your-cdn.example.com/type/ota npm run ota:prepare
```

`npm run ota:prepare` also works without `OTA_CDN_BASE_URL` if `VITE_OTA_MANIFEST_URL` is set
in env or `.env` (base URL is inferred from `.../manifest.json`).

This writes:

- `dist/ota/app-<version>.js`
- `dist/ota/app-<version>.css`
- `dist/ota/manifest.json` (with SHA-256 hash)

Set `VITE_OTA_MANIFEST_URL` to this manifest path (for example:
`https://your-cdn.example.com/type/ota/manifest.json`).

OTA flow:

1. Splash bootstrap (`src/ota-bootstrap.ts`) calls `prepare(manifestUrl)` then `start()`
2. `start()` loads OTA update content when available
3. Otherwise it loads bundled `app.js` fallback
4. App startup is registered via `register()` in `src/main.tsx`

Users can disable startup OTA checks in Settings -> Sync. When disabled, the app skips
`manifest.json` fetch and starts bundled assets directly.

## Notes storage

Notes are stored in a local folder tree. The app uses the first existing root:

1. `NOTES_ROOT` environment variable
2. `./notes`
3. `../notes`
4. App data fallback (`<app-data>/notes`)

Each folder has its own `.notes-order.json` to persist ordering of child folders and notes.

## Security mode (encryption + lock + panic)

When enabled in **Settings -> Security**:

- Note **body** content is encrypted at rest.
- File names and frontmatter remain plaintext.
- App launches in locked state by default.
- You can lock manually at any time (`Cmd/Ctrl+Shift+L` on desktop, or **Lock now** in settings).
- Optional auto-lock on background is configurable.

Unlock behavior:

- Normal unlock password unlocks notes.
- Panic password wipes local notes/profiles/settings/security state, then creates 3 dummy notes and reloads the app.

Notes:

- Panic reset is local-only and does not remove history from remote Git servers.
- Recording audio/attachments are not encrypted in this iteration.

## Git sync setup

The app uses `libgit2` (embedded Git) from Tauri commands. You do not need shell `git`.

### What gets synced

- All note markdown files (`.md`)
- Recording audio files (`Recordings/recording-*/audio.*`)
- Recording transcripts (`Recordings/recording-*/transcript.md`)
- Recording transcription state (`Recordings/recording-*/.transcription-status.json`)
- Folder structure and all `.notes-order.json` files

### One-time setup per device

Open **Settings → Profiles**, then fill in:

- **Remote URL** (e.g. `ssh://user@mac.local/path/to/repo.git`, `git://...`, or `https://...`)
- **Branch** (usually `main`)
- **Commit message** (default auto-commit message for push)
- **Username** and **Token/Password** (for HTTPS auth)

Then:

1. Tap **Connect repo**
2. If this is the first device with local notes: tap **Push**
3. If this device should download existing notes: tap **Pull** first

Or just tap **Sync now** — it connects (if needed), pushes local work, pulls and
merges remote changes, then pushes the result in one step.

### Three sync setups

The app supports three ways to sync, all driven from the same UI:

1. **Remote repo** — point the Remote URL at any internet Git host
   (`https://…` or `ssh://…`) and **Sync now**.
2. **Local repo over SSH** — same Wi-Fi, more secure. Enable Remote Login on the
   computer, use the `ssh://` URL shown by the server card, and the app's SSH key.
3. **Local repo over `git://`** — same Wi-Fi *or* your phone's personal hotspot.
   On the desktop, **Settings → Sync → Local network server → Start server**
   spawns a `git daemon` and shows a `git://` URL to paste on the phone. No
   internet and no external host required.

See [LOCAL_GIT_SERVER_LAN_HOTSPOT.md](LOCAL_GIT_SERVER_LAN_HOTSPOT.md) for the
local-network flow.

### SSH key auth (recommended)

For passwordless sync over SSH:

1. Go to **Settings → SSH key → Generate SSH key**
2. Copy the public key and add it to `~/.ssh/authorized_keys` on your server
3. Set the remote URL to `ssh://user@host/path/to/repo.git`
4. No username/password needed — the SSH key handles authentication

See [docs/ssh-sync-setup.md](docs/ssh-sync-setup.md) for full setup guide including security hardening.

### Daily flow

1. **Pull**
2. Edit notes
3. **Push**

### Multi-device example

1. Desktop: edit → **Push**
2. iOS: **Pull** → edit → **Push**
3. Desktop: **Pull**

### Pull / Push behavior

- **Pull** allows up-to-date and fast-forward updates
- If local changes exist, pull is blocked until you push/commit
- **Diverged history** is auto-merged when possible. If the same file was edited on both sides, the local version is kept and the remote version is saved as a `.conflict.md` sibling file. The merge always completes — sync is never blocked.
- **Push** auto-commits local changes with your message, then pushes to remote

### Conflict resolution

When a pull encounters conflicting changes to the same file:

- `note.md` — keeps the **local** version
- `note.conflict.md` — appears alongside with the **remote** version

Both files are plain readable markdown. Compare them, edit the original, delete the `.conflict.md` when done.

### Security note

- Git username/token are stored in local storage on the device
- SSH private key is stored in the app's sandboxed data directory
- Sensitive fields are redacted from frontend invoke logs
- Prefer least-privilege tokens and rotate/revoke when needed
- For SSH, restrict the key to git-only access — see [docs/ssh-sync-setup.md](docs/ssh-sync-setup.md)

## Audio recording + transcription

- Recordings are saved in `Recordings/` with a unique audio file per recording
- Start/stop recording from the left panel (desktop) or recording screen (mobile)
- Desktop auto-queues pending recordings for local transcription

### Desktop: local transcription (faster-whisper)

Desktop uses [faster-whisper](https://github.com/SYSTRAN/faster-whisper) to transcribe audio locally on your machine. No API key needed.

**Prerequisites (macOS with Apple Silicon):**

1. Install Python 3 (if not already present):
   ```bash
   brew install python
   ```

2. Install faster-whisper:
   ```bash
   pip3 install faster-whisper
   ```

3. The model (`large-v3`) downloads automatically on first transcription (~3 GB). This is cached in `~/.cache/huggingface/hub/` and reused for subsequent runs.

**How it works:**

- After a recording is saved, the app auto-queues it for transcription
- A background worker runs faster-whisper via Python subprocess
- Plain transcript text is written into the recording note body
- Word-level timestamps JSON is saved alongside the audio file as `<audio-name>.transcription.json`
- Check whisper status in **Settings → Recordings → Local transcription**
- Use the **Retranscribe** button on any recording to re-run transcription

**Verify setup:**

```bash
python3 -c "from faster_whisper import WhisperModel; print('OK')"
```

You can also check status in **Settings → Recordings** — it shows whether Python and faster-whisper are detected.

### Mobile: cloud transcription (AssemblyAI)

Mobile uses AssemblyAI for cloud-based transcription.

- Add your AssemblyAI key in **Settings → Recordings**
- Enable auto-queue in settings for automatic transcription on mobile

## Mobile UX

### Phone mode

- Stack navigation: Folders → Notes → Editor → Settings
- Back button and edge-swipe back gesture
- Long-press on note/folder opens action sheet
- Swipe left on notes for Archive / Delete actions
- Pull-to-refresh on notes list (refreshes tree + git status)

### Tablet mode

- Split view: left panel (folders/settings) + right panel (notes/editor)
- Portrait uses adaptive split with stable content

### Editor

- Save status line: Saving... / Saved / Save failed + Retry
- Debounced autosave (400ms)
- Guaranteed `flushSave()` on back navigation and app background/unload
- Keyboard inset handling via VisualViewport

## Troubleshooting

- **"Repository is not initialized. Connect a remote first."** — run Connect repo in Profiles settings
- **"No matching Git credentials available..."** — check username/token for HTTPS, or generate an SSH key in Settings for SSH remotes
- **Pull blocked by local changes** — push first, then pull
- **SSH "Permission denied"** — ensure public key is in `~/.ssh/authorized_keys` on the server, file has `chmod 600`
- **SSH "Connection refused"** — enable Remote Login on the Mac (System Settings → General → Sharing)

## Validation

### Build

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

### Manual checks

- Desktop: folder tree, note editing, DnD reorder, context menus, settings, keyboard shortcuts
- Phone: folders → notes → editor flow, back navigation, swipe actions, action sheets, sync
- Tablet: split view in portrait/landscape, rotation stability

## Backend structure

The Rust backend (`src-tauri/src/`) is organized into domain modules:

| File | Domain |
|------|--------|
| `lib.rs` | Module hub — shared utilities, constants, re-exports |
| `commands.rs` | All `#[tauri::command]` handlers (IPC layer) |
| `security.rs` | Encryption, password hashing, lock mode |
| `profiles.rs` | Multi-profile management, legacy migration |
| `notes.rs` | Note filesystem ops, front-matter, folder tree, ordering |
| `git.rs` | Git sync via libgit2 — fetch, push, merge, status, history, SSH key management |
| `recordings.rs` | Audio recording, AssemblyAI transcription queue |
| `handwriting.rs` | Handwriting attachment OCR (OpenAI / HuggingFace) |
| `ios.rs` | iOS-specific: native AVAudioRecorder, WKWebView recovery |

## Contributing

See [agents.md](./agents.md) for architecture, module map, and codebase patterns.
