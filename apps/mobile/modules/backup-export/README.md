# backup-export

Local Expo module for explicit, user-chosen mobile backups.

- `exportArchive(path, name)` presents iOS Files or Android
  `ACTION_CREATE_DOCUMENT` and streams the Rust core's ZIP to the chosen file.
- `copyFolder(path, name)` asks for a destination directory and recursively
  copies the working folder, including dotfiles, recordings, attachments, and
  Git data. Symlinks are deliberately skipped, matching the Rust ZIP writer.
- Transfers happen natively rather than moving file bytes through JS/base64.
- Failed directory copies are removed best-effort. iOS copies into a hidden
  staging directory and renames only after the full traversal succeeds.

The JS bridge lives in `src/lib/backup-export.ts`; the settings workflow deletes
the temporary app-container ZIP after the system export completes or is
cancelled.

Native compilation and provider behavior require Mac/iPhone and Android-device
verification. This Linux workspace intentionally does not build the mobile
native projects.
