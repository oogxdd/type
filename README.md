# Apple Notes Viewer (Tauri + React + TypeScript)

Local markdown notes app with optional Git sync, backed by filesystem storage through Tauri commands.

## Git Sync

Use Settings -> Sync to configure:

- `Remote repository URL` (for example `https://github.com/<you>/<repo>.git`)
- `Branch` (default `main`)
- `Commit message` for pushes

Actions:

- `Connect repo`: initializes a Git repo in the notes root (if needed) and configures `origin`
- `Pull`: runs `git pull --rebase origin <branch>`
- `Push`: stages all changes, creates a commit when needed, then runs `git push -u origin <branch>`

Notes:

- Sync runs against the app's notes root directory.
- Desktop requires Git to be installed and available in `PATH`.
- Authentication relies on your configured Git credentials (credential helper, SSH, PAT, etc.).

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
