import Foundation

#if canImport(ActivityKit)
import ActivityKit

// Shared contract between the app target (which starts / ends the activity) and
// the widget extension (which renders it). This file is compiled into *both*
// targets by the config plugin.
//
// The live timer on the Lock Screen is derived entirely from `startedAt` via
// SwiftUI's `Text(_:style: .timer)`, so it keeps ticking with no app process
// running and no per-second activity updates. The dynamic `ContentState` is
// therefore intentionally minimal.
@available(iOS 16.2, *)
public struct RecordingActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    // Reserved for a future pause control; also keeps ContentState stable/non-empty.
    public var paused: Bool

    public init(paused: Bool = false) {
      self.paused = paused
    }
  }

  // Wall-clock instant the recording began — the anchor the widget counts up from.
  public var startedAt: Date

  public init(startedAt: Date) {
    self.startedAt = startedAt
  }
}
#endif
