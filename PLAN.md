# Plan: iOS lock-screen recording (Live Activity) + fix the frozen recording timer

> Working branch: `feat/ios-recording-lock-activity` (off `main`).
> This file is committed as the **first** commit and deleted in the **last** commit.
> Target platform: **iOS only** (Android/Expo Go/web degrade to no-ops).

## The two asks

1. **Bug:** Start recording, let the screen sleep for ~10s, wake it — the timer is
   still `0:30` (it froze and never caught up). It should behave like Apple Voice
   Memos: keep recording through sleep and show the true elapsed time on wake.
2. **Feature:** Like Voice Memos — when the phone sleeps mid-recording and you wake
   it *without unlocking*, you see a "recording" surface on the Lock Screen with a
   live timer that you can **stop from** right there.

## Root cause of the freeze (what the code does today)

`apps/mobile/src/ui/dictation-button.tsx` is the entire recording UI (a floating
mic FAB; there is no dedicated record screen).

- The timer is a pure readout of `expo-audio`'s polled status:
  `Math.floor((recorderState.durationMillis ?? 0) / 1000)` (line ~250).
  `useAudioRecorderState` polls native status on a JS interval; when the app is
  suspended (screen lock) the interval stops, so the display freezes.
- The audio session is opened with
  `setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })`
  (line ~100) — **no background flag**. So when the app backgrounds on screen
  lock, the session is not kept active and the native recorder stalls: there is
  genuinely nothing to "catch up" to on wake. `durationMillis` is still ~30s.
- `Info.plist` already declares `UIBackgroundModes = [audio]` (injected by the
  expo-speech-recognition plugin), so the OS capability exists but the JS session
  never opts into it.

## Fix 1 — keep recording through sleep, show real elapsed time (JS only)

In `dictation-button.tsx`:

1. Open the session with background audio:
   `setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: true })`.
   Combined with the existing `UIBackgroundModes: [audio]`, `AVAudioRecorder`
   keeps capturing while the screen is locked. Revert with
   `shouldPlayInBackground: false` on stop.
2. Drive the visible timer from a **wall-clock anchor** instead of the polled
   `durationMillis`: capture `startedAt = Date.now()` when `record()` is called,
   tick a 500ms interval showing `Date.now() - startedAt`, and force a recompute
   on `AppState` → `active` so the value is correct the instant you return. Wall
   clock is immune to the JS-suspend freeze and reflects true elapsed time on wake.
3. Extract the `mm:ss` formatting into a pure, unit-tested helper
   (`src/lib/recording-timer.ts` + co-located `*.test.ts`, matching repo convention).

This alone fixes the reported bug.

## Fix 2 — Lock Screen recording surface with an interactive Stop (native iOS)

Use **ActivityKit Live Activities** (iOS 16.1+; interactive Stop button needs
iOS 17+). This is the modern, native "recording screen on the Lock Screen /
Dynamic Island" surface, and it live-updates its own timer via
`Text(timerInterval:)` without the app running.

New local Expo module: **`apps/mobile/modules/recording-activity/`** (Expo
autolinks `modules/*`; the app already uses `use_expo_modules!`).

- `ios/RecordingActivityModule.swift` — Expo module exposing to JS:
  `isSupported()`, `start(startedAtMs)`, `end()`, and an
  `onStopRequested` event emitted when the user taps Stop on the Lock Screen.
- `ios/RecordingAttributes.swift` — shared `ActivityAttributes` (static
  `startedAt: Date`; dynamic content-state) compiled into **both** the app and
  the widget target.
- `ios/widget/RecordingLiveActivityWidget.swift` — the SwiftUI Live Activity:
  Lock Screen banner (red dot + "Recording" + live timer + Stop) and the Dynamic
  Island (compact/expanded) presentations.
- `ios/widget/StopRecordingIntent.swift` — a `LiveActivityIntent` whose
  `perform()` runs in the app process, posts a Darwin/`NotificationCenter`
  signal, and ends the activity; the module forwards it to JS as `onStopRequested`.
- `expo-module.config.js`, `RecordingActivity.podspec`, `index.ts` (typed JS API
  with a lazy `require`/try-catch fallback so non-iOS / Expo Go / demo no-op).
- `plugin/` config plugin (added to `app.json` `plugins`):
  - app Info.plist `NSSupportsLiveActivities = true`;
  - App Group entitlement on the app (shared channel for app ↔ widget);
  - create + embed the **Widget Extension** target in the Xcode project during
    `expo prebuild`.

Wire into `dictation-button.tsx`: `start()` → `RecordingActivity.start(startedAt)`;
`stopAndSave()` → `RecordingActivity.end()`; subscribe to `onStopRequested` →
`stopAndSave()` (so stopping from the Lock Screen saves the clip like an in-app stop).

## Graceful degradation

Every `RecordingActivity` call is guarded and no-ops when the native module is
absent (Android, Expo Go, demo core, iOS < 16.1). Fix 1 works regardless.

## Verification boundary (important)

This workspace is **Linux with no Xcode/CocoaPods**, so the native target cannot
be compiled, prebuilt, or run here. Plan:

- Fully verify Fix 1's pure logic (the timer helper) and typecheck what the
  toolchain allows.
- Write the Swift/plugin to Apple + Expo conventions; it is materialized by
  `expo prebuild` and built/tested on a Mac. The module README documents the
  exact steps and what still needs on-device verification (Live Activity
  authorization, the Stop round-trip, background-recording continuation).

## Commit sequence

1. `docs: plan ios lock-screen recording + timer fix` (this file).
2. `fix(mobile): keep recording through screen sleep + wall-clock timer`.
3. `feat(mobile): recording-activity native module (ActivityKit) scaffold`.
4. `feat(mobile): lock-screen Live Activity widget + interactive Stop intent`.
5. `feat(mobile): config plugin (Live Activities, App Group, widget target)`.
6. `feat(mobile): start/stop the Live Activity from the dictation button`.
7. `docs(mobile): recording-activity README + delete PLAN.md`.

(Commits pushed along the way.)
