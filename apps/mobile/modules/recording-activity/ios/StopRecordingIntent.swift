import Foundation

// The cross-process signal names the Lock Screen Stop button uses to reach the
// app. Declared unconditionally (no availability / canImport guard) so both the
// app module and the widget target can reference them regardless of SDK checks.
public let kRecordingStopDarwinNotification = "com.typenotes.mobile.recording.stop"
public let kRecordingStopPendingDefaultsKey = "typenotes.recording.stopRequested"

#if canImport(AppIntents)
import AppIntents

// Backing intent for the Lock Screen / Dynamic Island "Stop" button.
//
// As a `LiveActivityIntent`, `perform()` runs in the *app's* process (not a
// separate extension process) and without bringing the app to the foreground —
// so the user can stop the recording from the Lock Screen without unlocking.
// It signals the app two ways:
//   1. a durable flag in the app's own UserDefaults (honored on next resume if
//      the JS runtime was suspended), and
//   2. a Darwin notification the running native module observes to stop
//      immediately.
@available(iOS 17.0, *)
public struct StopRecordingIntent: LiveActivityIntent {
  public static var title: LocalizedStringResource = "Stop Recording"
  public static var description = IntentDescription("Stops the in-progress voice recording.")
  // Run in the background; never force the app open / require unlock.
  public static var openAppWhenRun: Bool = false

  public init() {}

  public func perform() async throws -> some IntentResult {
    UserDefaults.standard.set(true, forKey: kRecordingStopPendingDefaultsKey)
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(),
      CFNotificationName(kRecordingStopDarwinNotification as CFString),
      nil,
      nil,
      true
    )
    return .result()
  }
}
#endif
