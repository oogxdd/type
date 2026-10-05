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

    // XCTest fixtures are restricted to Type Dev and a fresh cache directory.
    // Production never reads these launch variables or touches a notes root.
    Function("performanceFixture") { () -> [String: Any]? in
      guard Bundle.main.bundleIdentifier == "com.typenotes.mobile.dev",
            let raw = ProcessInfo.processInfo.environment["TYPE_PERF_NOTES"],
            let count = Int(raw), [1000, 5000, 10000].contains(count),
            let identifier = ProcessInfo.processInfo.environment["TYPE_PERF_ID"],
            UUID(uuidString: identifier) != nil else { return nil }
      let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("TypePerformance").appendingPathComponent(identifier)
      let delay = Int(ProcessInfo.processInfo.environment["TYPE_PERF_DELAY_MS"] ?? "0") ?? 0
      return ["root": root.path, "count": count, "delayMs": min(2000, max(0, delay))]
    }

    AsyncFunction("preparePerformanceFixture") { (root: String, count: Int) in
      guard Bundle.main.bundleIdentifier == "com.typenotes.mobile.dev",
            let identifier = ProcessInfo.processInfo.environment["TYPE_PERF_ID"],
            UUID(uuidString: identifier) != nil,
            let raw = ProcessInfo.processInfo.environment["TYPE_PERF_NOTES"],
            Int(raw) == count, [1000, 5000, 10000].contains(count) else {
        throw NSError(domain: "TypePerformance", code: 1)
      }
      let expected = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("TypePerformance").appendingPathComponent(identifier)
      guard URL(fileURLWithPath: root).standardizedFileURL == expected.standardizedFileURL else {
        throw NSError(domain: "TypePerformance", code: 2)
      }
      let stream = expected.appendingPathComponent("documents/notes/_system/stream")
      try FileManager.default.createDirectory(at: stream, withIntermediateDirectories: true)
      for index in 0..<count {
        let text = "---\ncreated_ms: \(1700000000000 + index * 60000)\n---\n\nSynthetic note \(index)\n\n" + String(repeating: "Fixture text. ", count: 40)
        try text.write(to: stream.appendingPathComponent("fixture-\(index).md"), atomically: true, encoding: .utf8)
      }
    }

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
