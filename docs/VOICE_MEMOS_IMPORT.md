# Importing Apple Voice Memos

Use the repository utility to import a Finder-exported Voice Memos folder into
the active Type profile. It hashes the audio before importing, so rerunning it
does not create duplicate recordings. Source files are never modified.

## Agent workflow and profile-local state

Read this document before acting on a request to import recordings. The CLI is
`crates/type-core/examples/import_voice_memos.rs`, invoked through the npm script
below. Importing requested user data is distinct from testing: use synthetic
profiles for tests.

1. Identify the requested source files. For a shared folder such as Downloads,
   select only the requested batch and stage copies in a temporary directory;
   do not import unrelated audio. The importer scans one directory, not subfolders.
2. Resolve the active profile using `.notes-profiles.json` in the selected
   app-data directory. Confirm its `notes_root` matches the user's intended
   destination before importing. Do not change the active profile implicitly or
   print unrelated config values/API keys. `--app-data-dir` selects an installation,
   not a profile within it.
3. Read `<notes-root>/.type/voice-memos-last-import.txt` if present. It contains
   only the ISO 8601 timestamp (with timezone) of the last verified successful
   import. It is a reminder, not a cutoff for source recordings or proof that
   audio has been listened to, reviewed or transcribed. Always deduplicate by hash.
4. Check original recording dates as described below, then run the preview.
   Even `--dry-run` resolves the profile and ensures its system folders, so it
   may require filesystem write permission.
5. Import the missing recordings and verify the result: match the imported audio
   SHA-256 hashes and corresponding Stream notes' `recording_audio_path` and
   `created_ms` against the selected files and intended original timestamps.
6. Only after a successful import and verification, atomically replace
   `<notes-root>/.type/voice-memos-last-import.txt` with the completion timestamp
   and a trailing newline. The CLI does **not** update this marker automatically;
   the agent must do it. Leave it unchanged on failure or a run with no new audio.
   Keep just this timestamp, not a per-file journal. Remove temporary staging
   copies after verification; retain the user's source files.

Keep personal paths, timestamps, filenames and import history in the user's
profile, outside the project repository. Do not restart their running app just
to import files.

## Preserve original recording dates

The importer uses the source file's filesystem creation time, falling back to
modification time; it does not read embedded audio dates or preserve Voice Memos
display names. Sharing/AirDrop can reset filesystem dates to the transfer time.
Check embedded metadata before importing an exported batch, for example:

```sh
ffprobe -v error -show_entries format_tags=creation_time -of json "/path/to/recording.m4a"
```

If the embedded `creation_time` preserves the recording date while the filesystem
date reflects the transfer, copy the selected files into a temporary directory.
On macOS, use `SetFile -d 'MM/DD/YYYY HH:MM:SS' "/path/to/staged-copy.m4a"` to set
each copy's creation time. Convert the embedded timestamp to the local timezone
first: `SetFile` interprets this value as local time. Verify `stat().st_birthtime`
matches the intended instant, then use the staged directory for both preview and
import. Changing only modification time with `touch`/`os.utime` is insufficient
when creation time is available. Never change the original Downloads files.

If no reliable original timestamp is available, report that limitation rather
than inventing a recording date.

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
- creates one recording note per new file in Stream (`_system/stream`);
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

## Empty or incomplete exports

Zero-byte files are skipped. Let Voice Memos download or repair the originals,
export them again, and rerun the utility. Hash-based deduplication imports only
newly valid or previously missing audio. Keep any personal recovery history in
the profile rather than this document.
