# Apple Notes Viewer (Tauri + React + TypeScript)

Local markdown notes app with optional Git sync, backed by filesystem storage through Tauri commands.

## Git Sync (Full Setup and Usage)

This app syncs notes through Git using embedded `libgit2` bindings (no shell `git` command required in the app).

### What Gets Synced

The entire notes root is versioned, including:

- note files (`.md`)
- folders
- per-folder ordering files (`.notes-order.json`)

### Notes Root Used for Sync

The app uses the first path that exists in this order:

1. `NOTES_ROOT` env var
2. `./notes`
3. `../notes`
4. app data fallback (`<app-data>/notes`)

Git repo initialization and all pull/push operations run in that notes root.

### Prerequisites

- A remote Git repository (GitHub/GitLab/etc.)
- Recommended for iOS/mobile: HTTPS remote URL + personal access token (PAT)

### One-Time Setup Per Device

In the app, open `Settings -> Sync` and set:

- `Remote repository URL`:
  - Example: `https://github.com/<you>/<repo>.git`
- `Branch`:
  - Usually `main`
- `Commit message`:
  - Used as default message for sync commits
- `Git username` + `Git token/password`:
  - Recommended for iOS and HTTPS remotes
  - For GitHub, username is your GitHub username, password is your PAT

Then:

1. Press `Connect repo`
2. If this is your first device with new local notes:
   - Press `Push` to create the remote branch/content
3. If this device should download existing notes:
   - Press `Pull` first, then start editing

### Daily Workflow (Desktop + iOS)

Recommended cycle on each device:

1. `Pull`
2. Edit notes
3. `Push`

This minimizes divergence and sync errors.

### Example Multi-Device Flow

1. Desktop: create/edit notes -> `Push`
2. iOS: `Pull` -> edit notes -> `Push`
3. Desktop: `Pull`

### Authentication Notes

- HTTPS:
  - Use username + token/password fields
  - If account has 2FA, use a token (not your account password)
- SSH:
  - Supported where an SSH agent is available
  - On iOS, HTTPS token auth is usually the practical option

### Current Pull Behavior and Conflict Handling

- `Pull` supports:
  - up-to-date
  - fast-forward updates
- If pull requires a merge commit (history diverged), app returns an error:
  - Resolve once on desktop (merge/rebase and push)
  - Then pull again on mobile
- If local uncommitted changes exist, pull is blocked until you push/commit first

### Security Note

- `Git username` and `Git token/password` are currently stored in app local storage on that device.
- Use a least-privilege token and rotate/revoke it if needed.

### Troubleshooting

- `Repository is not initialized. Connect a remote first.`
  - Run `Connect repo` in Settings -> Sync.
- `No matching Git credentials available for this remote.`
  - Fill `Git username` and `Git token/password`.
- Pull says merge/fast-forward issue:
  - Pull/merge on desktop, push, then pull on iOS.
- Remote URL changed:
  - Update URL and press `Connect repo` again.

## iOS Support (Tauri v2)

This project includes mobile entrypoint support and iOS icon assets. To run on iOS:

1. Install Apple/Xcode prerequisites (Xcode + command line tools, CocoaPods, Rust iOS targets).
2. Initialize iOS project files:
   - `yarn tauri:ios:init`
3. Run on simulator/device:
   - `yarn tauri:ios:dev`
4. Build release:
   - `yarn tauri:ios:build`

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
