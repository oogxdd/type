# recording-activity

iOS-only local Expo module that puts an in-progress voice recording on the **Lock
Screen and Dynamic Island** as an ActivityKit **Live Activity**, with a **Stop**
button that works without unlocking the phone — the Apple Voice Memos behaviour.

Paired with the audio-session change in `src/ui/dictation-button.tsx`
(`shouldPlayInBackground`), recording now survives the screen sleeping instead of
being silently truncated at lock time.

## How it works

```
JS  src/lib/recording-activity.ts        requireOptionalNativeModule("RecordingActivity")
     |  start / end / onStopRequested / consumePendingStop
     v
App target (compiled by RecordingActivity.podspec from ios/)
     ios/RecordingActivityModule.swift      Expo module; Activity.request / .end
     ios/RecordingActivityAttributes.swift  shared ActivityAttributes (startedAt)
     ios/StopRecordingIntent.swift          LiveActivityIntent + signal constants
     ^
     | Darwin notification + durable UserDefaults flag
     |
Widget target (created by the config plugin, sources copied to ios/RecordingWidget/)
     widget/RecordingActivityWidgetBundle.swift
     widget/RecordingLiveActivityWidget.swift   Lock Screen + Dynamic Island UI
     (+ copies of the two shared files above)
```

Two details worth knowing:

- **The timer needs no updates.** The Lock Screen counts up from the static
  `startedAt` via SwiftUI's `Text(_:style: .timer)`, so it ticks with no app
  process running and no per-second activity pushes. It uses the *same*
  wall-clock anchor as the in-app pill, so the two always agree.
- **Stop reaches JS two ways.** `StopRecordingIntent` is a `LiveActivityIntent`,
  so `perform()` runs in the **app's own process** (not an extension) and without
  foregrounding the app. It posts a Darwin notification (picked up immediately if
  the app is background-resumed) *and* writes a durable `UserDefaults` flag that
  JS honours on the next `AppState` → `active` if the runtime was suspended.
  Because the intent runs in the app process, **no App Group is required.**

## Building it

The native side only materialises through a prebuild on macOS:

```bash
# from the repo root
APP_VARIANT=dev npx expo prebuild --platform ios --clean   # runs the config plugin
npm run mobile:ios                                          # build & run
```

The config plugin (`app.plugin.js` → `plugin/withRecordingActivity.js`, registered
in `app.json`) does three things each prebuild:

1. sets `NSSupportsLiveActivities` on the app `Info.plist`;
2. copies `widget/*` + the two shared `ios/*.swift` files into `ios/RecordingWidget/`
   (the module folder is the source of truth, so `--clean` re-materialises them);
3. creates and embeds the `RecordingWidget` WidgetKit app-extension target.

In Xcode you then need to pick a **development team for the `RecordingWidget`
target** (it signs separately from the app). Its bundle id is
`<app bundle id>.RecordingWidget`.

## Verification status

Verified in CI / on Linux (`npm test`, `npx tsc --noEmit` in `apps/mobile`):

- the pbxproj mutation, run against the **real** `ios/Type.xcodeproj/project.pbxproj`
  — target creation, build settings, a single PlugIns embed phase, the
  app→widget dependency, a serialize/re-parse round-trip, and idempotency
  (`plugin/__tests__/add-widget-target.test.mjs`);
- `expo config --type introspect` applying `NSSupportsLiveActivities`;
- the wall-clock timer maths (`src/lib/recording-timer.test.ts`);
- typecheck of the JS bridge against the real `expo-modules-core` types.

**Not** verified — needs a Mac and a device, because this was authored on Linux
with no Xcode:

- Swift compilation of the module and the widget;
- `expo prebuild` executing the copy + target mods end to end;
- how the Live Activity actually looks on the Lock Screen / Dynamic Island;
- the Stop round-trip (intent → Darwin → module → JS → save) while locked;
- that recording genuinely continues through a screen sleep on-device;
- code signing of the extension target.

Treat the first device run as the real test of those.

## If the widget target is missing after prebuild

The pbxproj mutation is exercised by tests but has never been through a real
`expo prebuild`. If the target does not appear, add it by hand once and the
plugin's idempotency check will leave it alone:

1. Xcode → **File → New → Target → Widget Extension**, name it `RecordingWidget`,
   uncheck *Include Live Activity* (the sources already exist) and *Include
   Configuration Intent*.
2. Delete the generated stub sources.
3. Add the five files from `ios/RecordingWidget/` to the target (the two widget
   files plus the two shared ones and `Info.plist`).
4. Confirm the app target's embed phase copies `RecordingWidget.appex` into
   *PlugIns*, and set deployment target 16.4.

Note the two shared files (`RecordingActivityAttributes.swift`,
`StopRecordingIntent.swift`) are compiled into **both** targets — that is
intentional, not a mistake.

## Graceful degradation

Every JS entry point no-ops when the native module is absent — Android, Expo Go,
the demo core, or Live Activities disabled by the user. `isSupported()` reflects
`ActivityAuthorizationInfo().areActivitiesEnabled`. The recorder itself is
unaffected, so the background-recording fix works with or without this module.

On iOS 16.x the interactive Stop button is unavailable (it needs iOS 17); the
banner still shows the live timer and tapping it opens the app to stop there.
