# Apple Notes Viewer

Local markdown notes app with filesystem storage and optional Git sync. Runs on desktop and iOS via Tauri v2.

## Features

- **Folder tree** with drag-and-drop reordering
- **Markdown editor** (Tiptap) with debounced autosave
- **Git sync** — push/pull notes across devices using any Git remote
- **Audio recording + transcription** via AssemblyAI
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
OTA_CDN_BASE_URL=https://your-cdn.example.com/type npm run ota:prepare
```

This writes:

- `dist/ota/app-<version>.js`
- `dist/ota/app-<version>.css`
- `dist/ota/manifest.json` (with SHA-256 hash)

OTA flow:

1. Splash bootstrap (`src/ota-bootstrap.ts`) calls `prepare(manifestUrl)` then `start()`
2. `start()` loads OTA update content when available
3. Otherwise it loads bundled `app.js` fallback
4. App startup is registered via `register()` in `src/main.tsx`

## Notes storage

Notes are stored in a local folder tree. The app uses the first existing root:

1. `NOTES_ROOT` environment variable
2. `./notes`
3. `../notes`
4. App data fallback (`<app-data>/notes`)

Each folder has its own `.notes-order.json` to persist ordering of child folders and notes.

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

- **Remote URL** (e.g. `https://github.com/<user>/<repo>.git`)
- **Branch** (usually `main`)
- **Commit message** (default auto-commit message for push)
- **Username** and **Token/Password** (for HTTPS auth)

Then:

1. Tap **Connect repo**
2. If this is the first device with local notes: tap **Push**
3. If this device should download existing notes: tap **Pull** first

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
- If remote requires merge commit (diverged history), pull is blocked with a clear error — resolve on desktop, push, then pull on mobile
- **Push** auto-commits local changes with your message, then pushes to remote

### Security note

- Git username/token are stored in local storage on the device
- Sensitive fields are redacted from frontend invoke logs
- Prefer least-privilege tokens and rotate/revoke when needed

## Audio recording + transcription

- Recordings are saved in `Recordings/recording-<timestamp>/`
- Each recording folder contains:
  - `audio.*` (captured file)
  - `transcript.md` (written after successful transcription)
  - `.transcription-status.json` (queue/progress/error state)
- Start/stop recording from the left panel (desktop) or recording screen (mobile)
- Add your AssemblyAI key in **Settings → Recordings**
- Desktop auto-queues pending recordings for transcription when a key is present

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
- **"No matching Git credentials available..."** — check username/token for HTTPS remote
- **Pull blocked by local changes** — push first, then pull
- **Pull requires merge commit** — resolve divergence on desktop, push, then pull on mobile

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

## Contributing

See [agents.md](./agents.md) for architecture, module map, and codebase patterns.
