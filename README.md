# Apple Notes Viewer

Local markdown notes app with filesystem storage and optional Git sync. Runs on desktop and iOS via Tauri v2.

## Features

- **Folder tree** with drag-and-drop reordering
- **Markdown editor** with autosave
- **Git sync** — push/pull notes across devices using any Git remote (GitHub, GitLab, etc.)
- **Audio recording + transcription** via AssemblyAI
- **Multi-session** — separate notes folders with independent sync settings
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

## Git sync setup

1. Open **Settings → Sync**
2. Fill in remote URL, branch, username, and token
3. Tap **Connect repo**
4. **Push** (first device with notes) or **Pull** (to download existing notes)

Daily flow: Pull → Edit → Push.

## Notes storage

Notes live in a local folder tree. The app checks these roots in order:

1. `NOTES_ROOT` env var
2. `./notes`
3. `../notes`
4. App data fallback (`<app-data>/notes`)

Each folder has a `.notes-order.json` for persisting sort order.

## Contributing

```bash
npm run build        # tsc + vite build
```

See [AGENTS.md](./AGENTS.md) for architecture details, module map, and implementation patterns.
