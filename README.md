# Type

A **local-first markdown notes app**. Your notes are plain `.md` files in a folder on
your own disk — no account, no lock-in, readable and editable by any other tool. Optional
Git sync keeps them in step across devices, including a one-button local-network server so
a phone can sync over Wi-Fi or a hotspot with **no external host**.

Built with **Tauri v2** (Rust backend) and **React 19 / TypeScript** (frontend). Runs on
macOS, Windows, Linux, and iOS.

## Highlights

- **Plain-file storage** — notes are `.md` files in a folder tree you can point anywhere; order persists per folder.
- **Rich markdown editor** (Tiptap) with debounced autosave and a multi-note "lens" view.
- **Git sync** over `https://`, `ssh://`, or `git://` — push/pull across devices via libgit2 (no shell `git` needed).
- **One-button local sync** — host a `git daemon` on the desktop; the phone finds it by mDNS or QR code, no typing.
- **SSH key auth** — generate an Ed25519 keypair in-app for passwordless SSH.
- **Never-blocked merges** — conflicts keep your version and drop the remote copy beside it as `.conflict.md`.
- **Audio recording + transcription** — zero-install local Whisper on desktop, AssemblyAI on iOS.
- **Handwriting OCR** — import an image, get text back (OpenAI / Hugging Face).
- **At-rest encryption** — optional note-body encryption, a lock screen, and a panic password that wipes local data.
- **Multi-profile** — independent notes roots and sync settings.
- **Desktop & mobile UIs** — resizable three-pane on desktop; native-feeling stack/split navigation on phone/tablet.

## Tech stack & architecture

- **Frontend** — React 19, TypeScript, Vite, Tiptap, DnD Kit, Tailwind + shadcn/ui.
  Feature-sliced under `src/`: `app/` (composition root), `shared/` (domain-agnostic
  building blocks), `features/<domain>/`, plus thin `desktop/` and `mobile/` shells.
- **Backend** — Tauri v2 (Rust) in a pragmatic **domain / application / ports / adapters / commands**
  layout, so use cases can move to another shell (e.g. UniFFI for React Native) without a rewrite.

For the full module map and conventions see **[AGENTS.md](./AGENTS.md)**; for the backend,
**[src-tauri/README.md](src-tauri/README.md)**.

## Quick start

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

### Build & checks

```bash
npm run build                                   # tsc + web build + OTA fallback assets
cargo check --manifest-path src-tauri/Cargo.toml

npm test                                        # Vitest (frontend pure logic)
cargo test --manifest-path src-tauri/Cargo.toml --lib   # Rust unit tests
```

CI (`.github/workflows/ci.yml`) runs the typecheck and both test suites on every
pull request and on pushes to `main`.

Manual smoke checks:

- **Desktop** — folder tree, note editing, DnD reorder, context menus, settings, keyboard shortcuts
- **Phone** — folders → notes → editor flow, back navigation, swipe actions, action sheets, sync
- **Tablet** — split view in portrait/landscape, rotation stability

## Notes storage

Notes live in a local folder tree. The app uses the first existing root:

1. `NOTES_ROOT` environment variable
2. `./notes`
3. `../notes`
4. App-data fallback (`<app-data>/notes`)

Each folder keeps its own `.notes-order.json` to persist the order of its child folders and
notes. A few system folders are maintained automatically inside every root: `Feed` (default
notes), `Archieve` (archive — the spelling is intentional and persisted), and the hidden
`Recordings/` (audio storage).

## Security mode (encryption + lock + panic)

Enable in **Settings → Security**:

- Note **body** content is encrypted at rest (XChaCha20-Poly1305 with an Argon2id-derived key).
- File names and frontmatter stay plaintext by design.
- The app launches **locked**, and backend content commands reject requests until you unlock.
- Lock manually anytime (`Cmd/Ctrl+Shift+L`, or **Lock now** in settings); optional auto-lock on background.

Unlock vs. panic:

- The **unlock** password decrypts notes and derives the in-memory data key (never persisted in plaintext).
- The **panic** password wipes local notes/profiles/settings/security state, seeds 3 dummy notes, and reloads.

Notes:

- Panic reset is local-only — it does not remove history from remote Git servers.
- Recording audio and attachments are not encrypted in this iteration.

## Git sync

The app uses embedded **libgit2** from Tauri commands — you do not need shell `git`.

### What gets synced

- All note markdown (`.md`), including recording notes. A recording is just a note whose
  frontmatter references its audio and tracks transcription state (`recording_audio_path`,
  `transcription_status`, `transcription_id`, `transcription_error`); the transcript text is
  written into the note body once it completes (no separate transcript file).
- Recording audio, stored flat in the hidden `Recordings/` folder as `Recordings/audio-<id>.<ext>`.
- Folder structure and every `.notes-order.json`.

### One-time setup per device

In **Settings → Profiles**, fill in:

- **Remote URL** — `ssh://user@mac.local/path/to/repo.git`, `git://…`, or `https://…`
- **Branch** — usually `main`
- **Commit message** — the default auto-commit message for push
- **Username** / **Token/Password** — for HTTPS auth

Then tap **Connect repo**, and **Push** (first device with notes) or **Pull** (to download
existing notes). Or just tap **Sync now** — it connects if needed, pushes local work, pulls
and merges remote changes, then pushes the result, in one step.

### Three ways to sync

1. **Remote repo** — point the Remote URL at any internet Git host (`https://…` or `ssh://…`) and **Sync now**.
2. **Local repo over SSH** — same Wi-Fi, more secure. Enable Remote Login on the computer, use
   the `ssh://` URL from the server card and the app's SSH key.
3. **Local repo over `git://`** — same Wi-Fi *or* your phone's hotspot. On desktop,
   **Settings → Sync → Local network server → Start server** spawns a `git daemon`. The phone
   connects with no typing: **Find on local network** (mDNS/Bonjour) or scan the desktop's
   **QR code**. Manual URL entry is the fallback. No internet and no external host required.

See [docs/LOCAL_GIT_SERVER_LAN_HOTSPOT.md](docs/LOCAL_GIT_SERVER_LAN_HOTSPOT.md) for the
local-network flow.

### SSH key auth (recommended)

1. **Settings → SSH key → Generate SSH key**
2. Copy the public key into `~/.ssh/authorized_keys` on your server
3. Set the remote URL to `ssh://user@host/path/to/repo.git`
4. No username/password needed — the key authenticates

Full guide incl. hardening: [docs/ssh-sync-setup.md](docs/ssh-sync-setup.md).

### Pull / push & conflicts

- **Pull** allows up-to-date and fast-forward updates. If you have uncommitted local changes,
  pull is blocked until you push/commit.
- **Diverged history** is auto-merged when possible. If the same file changed on both sides,
  your local copy is kept and the remote copy is saved beside it as `note.conflict.md`.
  **The merge always completes — sync is never blocked.** Both files are plain markdown;
  compare, edit the original, and delete the `.conflict.md` when done.
- **Push** auto-commits local changes with your message, then pushes.

Typical loop: **Pull → edit → Push**. Across devices: Desktop edit → Push; iOS Pull → edit →
Push; Desktop Pull.

### Security notes

- Git username/token live in local storage on the device; the SSH private key lives in the app's sandboxed data dir.
- Sensitive fields are redacted from frontend invoke logs.
- Prefer least-privilege tokens; for SSH, restrict the key to git-only access (see the SSH guide).

## Audio recording + transcription

- Recordings are saved under `Recordings/` with a unique audio file each.
- Start/stop from the left panel (desktop) or the recording screen (mobile).

### Desktop — local Whisper (faster-whisper)

Desktop transcribes **locally** with [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
— no API key, nothing leaves your machine, and **no manual setup**. The app provisions and
owns an isolated Python + faster-whisper environment under its app-data directory using
[`uv`](https://docs.astral.sh/uv/) (it even fetches `uv` itself on first use). Open
**Settings → Recordings → Set up / Download model**, or just record — the first transcription
provisions automatically (the first run downloads the engine + model, so it can take a few
minutes).

- Default model `large-v3`; change it in **Settings → Recordings** (`medium`, `small`, … or an absolute path to a local model).
- A background worker writes plain transcript text into the note body and word-level timestamps to `<audio-name>.transcription.json` beside the audio.
- Check status, provision, or **Retranscribe** in **Settings → Recordings**.

### Mobile — cloud (AssemblyAI)

- Add your AssemblyAI key in **Settings → Recordings**.
- Enable auto-queue for automatic transcription on mobile.

## OTA updates (iOS WebView assets)

iOS web assets can be updated over-the-air via `@inkibra/tauri-plugin-ota`.

```bash
cp .env.example .env     # then set VITE_OTA_MANIFEST_URL
```

`npm run build` emits both the regular `index.html` assets and deterministic OTA fallback
assets (`dist/app.js`, `dist/app.css`). To prepare publishable artifacts + manifest:

```bash
OTA_CDN_BASE_URL=https://your-cdn.example.com/type/ota npm run ota:prepare
```

(`ota:prepare` also works without `OTA_CDN_BASE_URL` when `VITE_OTA_MANIFEST_URL` is set — the
base URL is inferred from `…/manifest.json`.) It writes `dist/ota/app-<version>.js`,
`dist/ota/app-<version>.css`, and `dist/ota/manifest.json` (with a SHA-256 hash). Point
`VITE_OTA_MANIFEST_URL` at that manifest.

Flow: the splash bootstrap (`src/ota-bootstrap.ts`) calls `prepare(manifestUrl)` then
`start()`, which loads OTA content when available and otherwise the bundled `app.js` fallback;
startup is registered via `register()` in `src/main.tsx`. Users can disable startup OTA checks
in **Settings → Sync** (the app then skips the manifest fetch and starts bundled assets directly).

## Mobile UX

- **Phone** — stack navigation (Folders → Notes → Editor → Settings), back button + edge-swipe,
  long-press action sheets, swipe-left Archive/Delete, pull-to-refresh (refreshes tree + git status).
- **Tablet** — split view (folders/settings | notes/editor); portrait uses an adaptive split with stable content.
- **Editor** — save status line (Saving… / Saved / Save failed + Retry), 400 ms debounced
  autosave, guaranteed `flushSave()` on back navigation and app background/unload, and
  VisualViewport keyboard-inset handling.

## Roadmap

> Rough, early ideas — not yet designed or scheduled.

- **Note "revisions" / multi-view notes (keep transcripts in the note, not in
  sidecar files).** Today the transcript result is already injected into the
  recording note's body, but everything still collapses into one flat body. The
  idea is to let a single note hold several distinct "revisions" (views/tabs),
  all stored inside the *same* markdown file — no separate files. For a
  recording that could be:
  - a. raw sentence/utterance-level transcript
  - b. the same transcript reformatted/cleaned up by an LLM
  - c. the user's own personal notes
  - d. anything else the user wants

  This is **not recording-specific** — any note could expose extra views/tabs
  (e.g. the main note plus a side tab of related info the user types). The open
  questions are how to encode multiple views in one markdown file and how the
  editor surfaces them. Needs deeper design before any implementation.

## Troubleshooting

- **"Repository is not initialized. Connect a remote first."** — run **Connect repo** in Profiles settings.
- **"No matching Git credentials available…"** — check username/token for HTTPS, or generate an SSH key for SSH remotes.
- **Pull blocked by local changes** — push first, then pull.
- **SSH "Permission denied"** — ensure the public key is in `~/.ssh/authorized_keys` and the file is `chmod 600`.
- **SSH "Connection refused"** — enable Remote Login on the Mac (System Settings → General → Sharing).

## Contributing

Architecture, module map, and codebase patterns live in **[AGENTS.md](./AGENTS.md)** (frontend
+ overview) and **[src-tauri/README.md](src-tauri/README.md)** (backend). The Rust backend is
organized as **ports / adapters / commands** across the `notes`, `profiles`, `security`,
`recordings`, `handwriting`, `git_sync`, `local_sync`, and `platform` domains.
