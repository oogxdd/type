import ExpoModulesCore
import UIKit

/**
 * Keeps Type running briefly after it is backgrounded, so the JS side can
 * flush open drafts and push them (see docs/SYNC_TIMING.md).
 *
 * The task begins natively, inside the didEnterBackground notification, rather
 * than when JS hears about it: the AppState event reaches JS asynchronously,
 * and by then iOS may already be suspending the app. JS calls `finish()` once
 * the sync settles; the expiration handler ends it if JS never does, so iOS
 * never kills the app for overrunning (~30 s budget).
 */
public final class BackgroundTaskModule: Module {
  private var taskId: UIBackgroundTaskIdentifier = .invalid
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("BackgroundTask")

    OnCreate {
      DispatchQueue.main.async { [weak self] in
        guard let self, self.observer == nil else { return }
        self.observer = NotificationCenter.default.addObserver(
          forName: UIApplication.didEnterBackgroundNotification,
          object: nil,
          queue: .main
        ) { [weak self] _ in
          self?.begin()
        }
      }
    }

    OnDestroy {
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        if let observer = self.observer {
          NotificationCenter.default.removeObserver(observer)
        }
        self.observer = nil
        self.end()
      }
    }

    Function("isSupported") { () -> Bool in
      true
    }

    AsyncFunction("finish") { [weak self] in
      self?.end()
    }.runOnQueue(.main)
  }

  private func begin() {
    guard taskId == .invalid else { return }
    taskId = UIApplication.shared.beginBackgroundTask(withName: "type-sync") { [weak self] in
      self?.end()
    }
  }

  private func end() {
    guard taskId != .invalid else { return }
    UIApplication.shared.endBackgroundTask(taskId)
    taskId = .invalid
  }
}
