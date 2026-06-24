# On-device transcription (Stage 4)

Turn a voice note into text **on the iPhone itself** — no Whisper, no
AssemblyAI, no account, no network. The audio never leaves the device. This is
the "iPhone-native" path from the brief: Apple's Speech framework
(`SFSpeechRecognizer`) running in on-device mode.

It is **optional and off by default** (`WorkspaceSettings.transcriptionEnabled`).
The phone is record-first; you can review/organize on the desktop after sync, or
flip transcription on here and have notes arrive already written.

## What it does

When enabled, the moment a recording is saved its note is queued. The transcript
becomes the note **body** and `transcription_status` walks the same states the
desktop uses:

```
pending ──▶ processing ──▶ completed   (body = transcript text)
                      └──▶ failed       (body stays empty, error recorded)
```

This is written by `NotesStore.updateRecordingTranscription`, a direct port of
the Rust `update_recording_note_status`
(`src-tauri/src/adapters/recordings/mod.rs`). The body rule is the port of
`recording_note_body`: **empty unless `completed`**, then the trimmed transcript
plus a single trailing newline (an empty transcript stays an empty body). So a
note transcribed on the phone is byte-identical to one the desktop would have
produced — the same git repo round-trips with no drift.

## The pieces

```
AudioRecorder.onSaved(path)                 a recording was just written
        │
        ▼
TranscriptionManager.enqueue(path) ──┐
                                     │  (serial, single-flight, in-app)
Settings ▸ "Transcribe pending" ─────┤
  → enqueuePending(): scan tree for  │
    pending/queued/failed recordings │
                                     ▼
        NotesStore.collectRecordingNotes()      find recording notes + audio
        SFSpeechRecognizer (on-device)          audio file → text
        NotesStore.updateRecordingTranscription status + body on disk
        onUpdated() → AppState.refreshTree()    note shows the transcript
```

- **`Transcription/TranscriptionManager.swift`** — `@MainActor @Observable`
  singleton. A lightweight serial queue (one recognition at a time). It holds no
  persisted state: the source of truth is each note's `transcription_status` on
  disk, so a crash mid-run just leaves a note `processing` and a later
  "Transcribe pending" re-runs it.
- **`Storage/NotesStore.swift`** — `collectRecordingNotes()` (port of
  `collect_recording_notes` + `recording_info_from_note_meta`) and
  `updateRecordingTranscription(…)` / `recordingNoteBody(…)`.
- **`App/AppState.swift`** — `configureTranscription()` points the manager at the
  active workspace and refreshes the tree on every status change; the recorder's
  `onSaved` enqueues the new note; `transcribePendingRecordings()` backs the
  Settings button.
- **`Features/Settings/SettingsView.swift`** — the toggle, a manual
  "Transcribe pending recordings" action, and a live status line.

## Why on-device only (no server fallback)

`SFSpeechRecognizer` can also recognize via Apple's servers, but we deliberately
require on-device:

- It keeps the app **local-first / private** — consistent with git-only sync and
  no third-party transcription service.
- `request.requiresOnDeviceRecognition = true`, and we first check
  `recognizer.supportsOnDeviceRecognition`. If the device/locale can't do offline
  recognition we mark the note **failed** with a clear message rather than
  silently uploading the audio.

If you later want a cloud option, it would be an explicit, separately-gated
setting — not a silent fallback.

## Xcode / device setup

- **Info:** `NSSpeechRecognitionUsageDescription` — e.g. "Type transcribes your
  recordings on-device." (Already listed in the main README.) Microphone usage
  (`NSMicrophoneUsageDescription`) is the Stage 3 key.
- **Authorization:** first run calls `SFSpeechRecognizer.requestAuthorization`;
  the user must allow Speech Recognition. Denial → notes fail with an
  "isn't authorized" error (re-enable under Settings ▸ Type).
- **Offline language:** on-device recognition needs the language installed for
  offline dictation. Add it under **Settings ▸ General ▸ Keyboard ▸ Dictation**
  (or it downloads on first on-device use). `SFSpeechRecognizer()` uses the
  device's current locale.

## ⚠️ Verify on device first

Written without an iOS toolchain. On the first device build, check:

1. **`supportsOnDeviceRecognition`** is true for your locale; otherwise every
   note fails with the offline-unsupported message (expected — add the language).
2. **Final result only** — we set `shouldReportPartialResults = false` and resume
   on `result.isFinal`. Confirm a real recording yields a final transcription and
   the body is written exactly once (the `ResumeGate` guards a double callback).
3. **Status round-trip** — record with transcription on, let it finish, then open
   the note: body should be the transcript and the front-matter
   `transcription_status: completed`. Sync and confirm the desktop agrees.
4. **Long recordings / battery** — recognition is CPU-bound. The queue is serial
   by design; a backlog (e.g. after enabling on an old library) transcribes one
   at a time.
5. **Background completion** — if the app is backgrounded mid-transcription,
   confirm the job either finishes or the note is left `processing` for a later
   retry (no half-written body).
