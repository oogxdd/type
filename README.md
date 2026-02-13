# Apple Notes Viewer (Tauri + React + TypeScript)

Local markdown notes app with filesystem storage and optional Git sync across desktop and iOS.

## Architecture

### UI shells

- `src/App.tsx` is the shared orchestrator (state, data loading, editor lifecycle, git sync actions).
- `src/desktop/DesktopShell.tsx` contains desktop layout and behavior.
- `src/mobile/MobileShell.tsx` contains phone/tablet-native navigation and interactions.

### Layout mode breakpoints

- `phone`: `< 768px`
- `tablet`: `768px - 1024px`
- `desktop`: `> 1024px`

### Mobile modules

- `src/mobile/navigation.ts` — mobile route types + reducer.
- `src/mobile/useLayoutMode.ts` — breakpoint/orientation layout detection.
- `src/mobile/useKeyboardInsets.ts` — keyboard/viewport insets (VisualViewport).
- `src/mobile/components/*` — mobile navigation, screens, action sheets, prompt sheets, tab bar, toast.
- `src/mobile/mobile.css` — mobile-specific design tokens and styles.

## Notes Storage

Notes are stored in a local folder tree. The app uses the first existing root:

1. `NOTES_ROOT` environment variable
2. `./notes`
3. `../notes`
4. app data fallback (`<app-data>/notes`)

Each folder has its own `.notes-order.json` to persist ordering of:

- child folders
- notes in that folder

So yes, `.notes-order.json` is per directory.

## Git Sync Setup (Initial + Daily Use)

The app uses `libgit2` (embedded Git) from Tauri commands. You do not need shell `git` inside the app.

### What gets synced

- all note markdown files (`.md`)
- recording audio files (`Recordings/recording-*/audio.*`)
- recording transcripts (`Recordings/recording-*/transcript.md`)
- recording transcription state (`Recordings/recording-*/.transcription-status.json`)
- folder structure
- all `.notes-order.json` files

### Prerequisites

- remote Git repository (GitHub/GitLab/etc.)
- for iOS: recommended `HTTPS + PAT`

### One-time setup per device

Open `Settings -> Sync`, then fill:

- `Remote URL` (for example: `https://github.com/<user>/<repo>.git`)
- `Branch` (usually `main`)
- `Commit message` (default auto-commit message for push)
- `Username` and `Token/Password` (for HTTPS auth)

Then:

1. Tap `Connect repo`
2. If this is the first device with local notes: tap `Push`
3. If this device should download existing notes: tap `Pull` first

### Recommended daily flow (all devices)

1. `Pull`
2. Edit notes
3. `Push`

This keeps histories aligned and avoids pull conflicts.

### Multi-device example

1. Desktop: edit -> `Push`
2. iOS: `Pull` -> edit -> `Push`
3. Desktop: `Pull`

### Pull / Push behavior

- `Pull` allows up-to-date and fast-forward updates.
- If local changes exist, pull is blocked until you push/commit.
- If remote requires merge commit (diverged history), pull is blocked with a clear error. Resolve on desktop, push, then pull on mobile.
- `Push` auto-commits local changes with your message, then pushes to remote.

### Security note (current implementation)

- Git username/token are currently stored in local storage on the device.
- Sensitive fields are redacted from frontend invoke logs.
- Prefer least-privilege tokens and rotate/revoke when needed.

## iOS (Tauri v2)

### One-time project init

```bash
yarn tauri:ios:init
```

### Run in simulator/device

```bash
yarn tauri:ios:dev
```

### Build release

```bash
yarn tauri:ios:build
```

## Mobile UX Behavior

## Audio Recording + Transcription

- Recordings are saved in `Recordings/recording-<timestamp>/`.
- Each recording folder contains:
  - `audio.*` (captured file)
  - `transcript.md` (written after successful transcription)
  - `.transcription-status.json` (queue/progress/error state)
- Start/stop recording from `Settings -> Recordings` (desktop + mobile).
- Add your AssemblyAI key in `Settings -> Recordings`.
- Desktop auto-scans and queues pending recordings for transcription when a key is present.

### Phone mode

- Stack navigation:
  - `Folders -> Notes -> Editor -> Settings`
- Back navigation:
  - back button
  - edge-swipe back gesture
- Long-press on note/folder opens native-style action sheet.
- Notes list supports:
  - pull-to-refresh (`tree + git status`)
  - swipe left actions (`Archive`, `Delete`)

### Tablet mode

- Split view shell:
  - left: folders/settings switch
  - right: notes + editor (or settings content)
- Portrait uses adaptive split with stable content and no desktop resizable panels.

### Editor mobile ergonomics

- save status line (`Saving...`, `Saved`, `Save failed + Retry`)
- debounced autosave
- guaranteed `flushSave()` on editor back navigation and app background/unload
- keyboard inset handling with VisualViewport to avoid cursor/content being hidden

### Mobile sync UX

- dedicated mobile sync cards:
  - Repository
  - Authentication
  - Sync actions
  - Sync status
- explicit blocking feedback for common pull/push issues
- local `last successful sync` timestamp shown in status

## Validation Matrix

### Build/static

```bash
yarn build
cargo check --manifest-path src-tauri/Cargo.toml
```

### Manual phone checks

1. Open app on iPhone viewport -> folders root appears.
2. Folder -> notes -> editor flow works with back navigation.
3. Back from editor preserves edits (flush save).
4. Keyboard does not cover editing content.
5. Swipe note actions and long-press action sheet work.
6. Sync actions show busy/error/status states clearly.

### Manual tablet checks

1. Split view works in portrait and landscape.
2. Rotate device -> no state loss.
3. Settings + notes/editor switching is stable.

### Desktop regression checks

1. Existing desktop layout and DnD still work.
2. Desktop context menus still work.
3. Desktop settings and editor behavior unchanged.

## Troubleshooting

- `Repository is not initialized. Connect a remote first.`
  - run `Connect repo` in Sync settings.
- `No matching Git credentials available...`
  - check username/token for HTTPS remote.
- Pull blocked by local changes
  - push first, then pull.
- Pull requires merge commit
  - resolve divergence on desktop, push, then pull on mobile.
