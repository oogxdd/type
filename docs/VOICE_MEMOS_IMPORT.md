# Importing Apple Voice Memos

Use the repository utility to import a Finder-exported Voice Memos folder into
the active Type profile. It hashes the audio before importing, so rerunning it
does not create duplicate recordings. Source files are never modified.

## 1. Export from Voice Memos storage

Voice Memos on macOS does not provide a reliable Select All action. In Finder,
press **Shift-Command-G** and open:

```text
~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings
```

Copy the folder contents into an ordinary folder, for example
`Voice Memos export YYYY-MM-DD` on the Desktop. Finder may be able to perform
this user-initiated copy even when Terminal or Codex receives
`Operation not permitted`. Let Voice Memos finish downloading any iCloud-only
recordings before copying.

## 2. Preview the import

From the repository root:

```sh
npm run voice-memos:import -- \
  --source "/Users/<you>/Desktop/Voice Memos export YYYY-MM-DD" \
  --dry-run
```

The preview reports files already present in Type, new unique audio, duplicates
inside the export, and empty files that cannot be imported.

## 3. Import only missing recordings

Run the same command without `--dry-run`:

```sh
npm run voice-memos:import -- \
  --source "/Users/<you>/Desktop/Voice Memos export YYYY-MM-DD"
```

The utility:

- targets the active profile in the production app data directory;
- compares SHA-256 hashes against `_system/_recordings`;
- creates one recording note per new file in Feed;
- preserves the source file creation timestamp;
- follows the configured note filename format;
- skips zero-byte and duplicate files.

For a development or alternate installation, pass its app-data directory:

```sh
npm run voice-memos:import -- \
  --source "/path/to/export" \
  --app-data-dir "/path/to/app-data"
```

If Type is open with desktop transcription enabled, newly imported recordings
may be queued for transcription automatically.

## Zero-byte files found on 2026-09-27

The full export contained 363 `.m4a` files. Of those, 355 contained audio and
the following eight originals were zero bytes, so the importer skipped them:

```text
20260119 001911-340C0FC1.m4a
20260208 071159-D9D69601.m4a
20260216 232135-BFF56C66.m4a
20260613 050942-13D7A168.m4a
20260614 063947-E0523DC7.m4a
20260707 161205-21C6B196.m4a
20260808 183221-94EAE06F.m4a
20260810 052220-4A014EEB.m4a
```

If Voice Memos later downloads or repairs any of these, copy the export again
and rerun the utility. Hash-based deduplication will import only newly valid or
previously missing audio.

On 2026-09-29 all eight recordings were exported again with valid audio and
successfully imported into Type. The list remains here as recovery history; it
does not describe the current state of the repaired exports.
