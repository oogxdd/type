import ExpoModulesCore
import Foundation

#if canImport(ActivityKit)
import ActivityKit
#endif

// JS-facing bridge to ActivityKit. Every entry point degrades safely on
// unsupported OS / disabled Live Activities so the JS layer can call it blindly.
public class RecordingActivityModule: Module {
  private var darwinObserverRegistered = false

  public func definition() -> ModuleDefinition {
    Name("RecordingActivity")

    // Emitted when the user taps "Stop" on the Lock Screen (see StopRecordingIntent).
    Events("onStopRequested")

    OnCreate {
      self.registerDarwinObserver()
    }

    OnDestroy {
      self.unregisterDarwinObserver()
    }

    // True only when Live Activities are available and enabled by the user.
    Function("isSupported") { () -> Bool in
      #if canImport(ActivityKit)
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      #endif
      return false
    }

    // Returns (and clears) the durable stop flag left by the Lock Screen intent
    // while the app was suspended. JS calls this on foreground to honor a stop
    // the live event may have missed.
    Function("consumePendingStop") { () -> Bool in
      let pending = UserDefaults.standard.bool(forKey: kRecordingStopPendingDefaultsKey)
      if pending {
        UserDefaults.standard.set(false, forKey: kRecordingStopPendingDefaultsKey)
      }
      return pending
    }

    // Start the Lock Screen / Dynamic Island activity. Resolves true when an
    // activity was actually requested, false when unsupported/disabled.
    AsyncFunction("start") { (startedAtMs: Double, promise: Promise) in
      #if canImport(ActivityKit)
      if #available(iOS 16.2, *) {
        // Drop any stale flag from a previous recording.
        UserDefaults.standard.set(false, forKey: kRecordingStopPendingDefaultsKey)
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
          promise.resolve(false)
          return
        }
        // Coalesce: never run two recording activities at once.
        for activity in Activity<RecordingActivityAttributes>.activities {
          Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
        let startedAt = Date(timeIntervalSince1970: startedAtMs / 1000.0)
        let attributes = RecordingActivityAttributes(startedAt: startedAt)
        let content = ActivityContent(
          state: RecordingActivityAttributes.ContentState(paused: false),
          staleDate: nil
        )
        do {
          _ = try Activity.request(attributes: attributes, content: content, pushType: nil)
          promise.resolve(true)
        } catch {
          promise.reject("ERR_ACTIVITY_START", error.localizedDescription)
        }
        return
      }
      #endif
      promise.resolve(false)
    }

    // End any in-progress recording activity.
    AsyncFunction("end") { (promise: Promise) in
      #if canImport(ActivityKit)
      if #available(iOS 16.2, *) {
        UserDefaults.standard.set(false, forKey: kRecordingStopPendingDefaultsKey)
        Task {
          for activity in Activity<RecordingActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
          }
          promise.resolve(nil)
        }
        return
      }
      #endif
      promise.resolve(nil)
    }
  }

  // MARK: - Darwin notification (Lock Screen Stop -> running JS)

  private func registerDarwinObserver() {
    guard !darwinObserverRegistered else { return }
    darwinObserverRegistered = true
    let observer = Unmanaged.passUnretained(self).toOpaque()
    CFNotificationCenterAddObserver(
      CFNotificationCenterGetDarwinNotifyCenter(),
      observer,
      { (_, observer, _, _, _) in
        guard let observer = observer else { return }
        Unmanaged<RecordingActivityModule>.fromOpaque(observer)
          .takeUnretainedValue()
          .handleStopRequested()
      },
      kRecordingStopDarwinNotification as CFString,
      nil,
      .deliverImmediately
    )
  }

  private func unregisterDarwinObserver() {
    guard darwinObserverRegistered else { return }
    darwinObserverRegistered = false
    let observer = Unmanaged.passUnretained(self).toOpaque()
    CFNotificationCenterRemoveObserver(
      CFNotificationCenterGetDarwinNotifyCenter(),
      observer,
      CFNotificationName(kRecordingStopDarwinNotification as CFString),
      nil
    )
  }

  private func handleStopRequested() {
    DispatchQueue.main.async {
      self.sendEvent("onStopRequested", [:])
    }
  }
}
