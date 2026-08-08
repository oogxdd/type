import ActivityKit
import SwiftUI
import WidgetKit

// The Lock Screen banner + Dynamic Island presentations for an in-progress
// recording. The timer counts up from `startedAt` using SwiftUI's built-in
// `.timer` text style, so it stays live with no app process and no activity
// content pushes.
@available(iOS 16.2, *)
struct RecordingLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
      RecordingLockScreenView(startedAt: context.attributes.startedAt)
        .activityBackgroundTint(Color.black.opacity(0.55))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 6) {
            RecordingDot()
            Text("Recording").font(.headline)
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(context.attributes.startedAt, style: .timer)
            .monospacedDigit()
            .font(.headline)
            .multilineTextAlignment(.trailing)
            .frame(maxWidth: 64)
        }
        DynamicIslandExpandedRegion(.bottom) {
          StopButton()
        }
      } compactLeading: {
        RecordingDot()
      } compactTrailing: {
        Text(context.attributes.startedAt, style: .timer)
          .monospacedDigit()
          .frame(maxWidth: 44)
      } minimal: {
        RecordingDot()
      }
      .keylineTint(.red)
      .widgetURL(URL(string: "typenotes://recording"))
    }
  }
}

@available(iOS 16.2, *)
private struct RecordingLockScreenView: View {
  let startedAt: Date

  var body: some View {
    HStack(spacing: 12) {
      RecordingDot()
      VStack(alignment: .leading, spacing: 2) {
        Text("Recording")
          .font(.headline)
          .foregroundStyle(.white)
        Text(startedAt, style: .timer)
          .monospacedDigit()
          .font(.system(.title3, design: .rounded))
          .foregroundStyle(.white.opacity(0.85))
      }
      Spacer(minLength: 12)
      StopButton()
    }
    .padding(.horizontal, 20)
    .padding(.vertical, 14)
    // iOS 16 (no interactive button): tapping the banner opens the app to stop.
    .widgetURL(URL(string: "typenotes://recording"))
  }
}

private struct RecordingDot: View {
  var body: some View {
    Circle()
      .fill(Color.red)
      .frame(width: 10, height: 10)
  }
}

private struct StopButton: View {
  var body: some View {
    if #available(iOS 17.0, *) {
      Button(intent: StopRecordingIntent()) {
        stopLabel
      }
      .tint(.red)
      .buttonStyle(.borderedProminent)
    } else {
      // iOS 16: interactive intents are unavailable, so this is a visual cue;
      // the banner's widgetURL opens the app to stop.
      stopLabel
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Color.red, in: Capsule())
    }
  }

  private var stopLabel: some View {
    Label("Stop", systemImage: "stop.fill")
      .font(.subheadline.weight(.semibold))
      .foregroundStyle(.white)
  }
}
