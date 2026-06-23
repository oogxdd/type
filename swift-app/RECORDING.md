# Voice recording + widgets (Stage 3)

Record a voice note from inside the app, from a **home-screen widget**, from a
**lock-screen widget / Control Center control**, and control an in-progress
recording from a **Live Activity** on the lock screen — then it syncs to the same
git repo as a desktop-compatible `audio_recording` note.

## The one rule: capture always runs in the app

Only the app target owns the `AVAudioSession` and the `audio` background mode, so
**all microphone capture happens in the app process** (`AudioRecorder.shared`).
Widgets and the Live Activity never record; they just *ask the app to*.

This matches how the system Voice Memos app behaves: the app keeps the audio
session alive in the background, and the lock-screen UI is a remote control for
it.

## How the pieces talk

```
 ┌─────────────────────────┐         ┌──────────────────────────────┐
 │  Widget extension        │        │  App process                 │
 │  (Type Record Widget)    │        │  (Type)                      │
 │                          │        │                              │
 │  • Home-screen widget ───┼─ deep ─┼─▶ openURL(type://record)     │
 │    type://record          │  link  │     → RootView → Record tab  │
 │                          │        │     → AudioRecorder.start()  │
 │                          │        │                              │
 │  • Control / Live Activity│       │                              │
 │    buttons (App Intents) │        │                              │
 │      RecordingBridge.send─┼─ App  ─┼─▶ CFNotification (Darwin)    │
 │      (.start/.stop/…)     │ Group │     → AudioRecorder           │
 │                          │ +Darwin│        .handleBridgeCommand()│
 │                          │        │     → start/stop/toggle      │
 │   reads RecordingBridge ◀─┼─ App ─┼── AudioRecorder publishes    │
 │   .readState() for UI     │ Group │   isRecording/startedAt       │
 └─────────────────────────┘         └──────────────────────────────┘
```

Two transports, by purpose:

- **Deep link** (`type://record`) — used by the home-screen widget and the
  circular lock-screen accessory. It *foregrounds* the app, which is the most
  reliable way to cold-start a recording.
- **App Group + Darwin notification** (`RecordingBridge` / `RecordingSignal`) —
  used by App-Intent buttons (Control widget, Live Activity, rectangular lock
  accessory). The intent drops a command in the shared `UserDefaults` suite and
  posts a Darwin notification; the app observes it and acts. State flows back the
  same way (App Group) so the Control toggle renders the real recording state.

## Starting from the lock screen *without* unlocking

The intents that start capture (`StartRecordingIntent`,
`RecordingControlToggleIntent`) conform to **`AudioRecordingIntent`** (iOS 18+).
That's the system capability that lets iOS wake the app in the background **with
microphone privileges** from a lock-screen control — the same mechanism the
built-in Voice Memos Control uses. The pause/stop buttons inside a running Live
Activity are **`LiveActivityIntent`s**; the app is already alive holding the
session, so they work from the lock screen too.

> **Honest limitation to verify on device.** Background microphone start from a
> *locked* device is gated by iOS and by the user's privacy settings. The
> reliable, always-works paths are: (a) the home-screen widget deep link
> (foregrounds the app), and (b) controlling an **already-running** recording from
> the Live Activity / lock screen. A brand-new start from a cold lock-screen
> control depends on `AudioRecordingIntent` waking the app; if a given iOS build
> or setting refuses background mic, it falls back to requiring unlock. This is a
> platform constraint, not a code bug — there is no API that lets an *extension*
> capture the mic on the lock screen.

## Files

App target (`Type/Type/`):

- `Recording/AudioRecorder.swift` — the capture engine (singleton, `@Observable`,
  `MainActor`). AVAudioRecorder → `Recordings/audio-<uuidv7>.m4a`, writes the note
  via `NotesStore.createRecordingNote`, owns the Live Activity, observes the
  Darwin command bridge.
- `Recording/Shared/RecordingShared.swift` — App Group bridge + Darwin signal
  (**duplicated** into the widget target).
- `Recording/Shared/RecordingActivityAttributes.swift` — Live Activity contract
  (**duplicated** into the widget target).
- `Features/Record/RecordingView.swift` — in-app recording screen; auto-starts on
  the `type://record` deep link.
- `App/AppState.swift` — `configureRecorder()` points the engine at the active
  workspace + refreshes the tree on save.
- `App/RootView.swift` — Record tab; routes the deep link there.

Widget target (`Type/Type Record Widget/`):

- `RecordIntents.swift` — `StartRecordingIntent` (`AudioRecordingIntent`),
  `StopRecordingIntent` / `ToggleRecordingIntent` (`LiveActivityIntent`),
  `RecordingControlToggleIntent` (`SetValueIntent` + `AudioRecordingIntent`).
- `RecordWidget.swift` — home-screen `systemSmall` + `accessoryCircular` /
  `accessoryRectangular` lock-screen widgets.
- `RecordControl.swift` — Control-Center / lock-screen `ControlWidget` toggle.
- `RecordingLiveActivity.swift` — lock-screen + Dynamic Island Live Activity.
- `RecordWidgetBundle.swift` — `@main` bundle.
- `RecordingShared.swift`, `RecordingActivityAttributes.swift` — the duplicated
  shared types (keep identical to the app copies).

## Note shape written on stop

Byte-identical to the desktop recorder (`src-tauri/src/adapters/recordings/mod.rs`):

```
---
id: <uuidv7>
created_ms: <now>
updated_ms: <now>
type: audio_recording
recording_audio_path: "Recordings/audio-<uuidv7>.m4a"
transcription_status: pending
transcription_updated_ms: <now>
---

```

Empty body; the audio file lives in the hidden `Recordings/` folder; the note is
placed in `Feed` (or the active folder). Stage 4 fills the body with a transcript
and flips `transcription_status`.

## Xcode setup required (recap)

These are listed in the main README; all are needed for Stage 3:

- **Info:** `CFBundleURLTypes` scheme `type`, `NSMicrophoneUsageDescription`,
  `UIBackgroundModes` → `audio`, `NSSupportsLiveActivities = YES`.
- **Capabilities:** **App Groups** `group.com.digital.Type` on **both** targets;
  **Background Modes → Audio** on the app.
- The widget target deploys the same App Group; the Control widget + Live Activity
  need iOS 18 / 16.1 respectively (deployment target is iOS 26.1, so fine).

## ⚠️ Verify on device first

This was written without an iOS toolchain. On the first device build, check:

1. **App Group enabled on both targets** — without it, `RecordingBridge` reads/
   writes a nil suite and the widget/app can't see each other's state.
2. **`AudioRecordingIntent` availability + behavior** — confirm a lock-screen
   Control start actually wakes the app and begins capture on your iOS build;
   otherwise rely on the deep-link + Live Activity paths (see limitation above).
3. **Live Activity request** — `Activity.request(attributes:content:pushType:)`
   signature + `ActivityAuthorizationInfo().areActivitiesEnabled`. Enable Live
   Activities in Settings ▸ Type.
4. **Two duplicated files stay identical** — `RecordingShared.swift` and
   `RecordingActivityAttributes.swift` exist once per target; a drift breaks the
   bridge or the activity decoding.
5. **Background audio** — recording should continue when you lock the device; if
   it stops, re-check the `audio` background mode + that the session is
   `.playAndRecord` and active.
