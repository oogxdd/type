//
//  RecordingLiveActivity.swift
//  Type Record Widget   (widget extension target)
//
//  The lock-screen / Dynamic Island Live Activity shown while recording — the
//  "native Voice Memos" surface. Its pause/stop buttons run `LiveActivityIntent`s
//  that bridge to the app (which is alive in the background holding the audio
//  session), so you control the recording from the lock screen without unlocking.
//
//  The elapsed clock uses `Text(_:style:.timer)` driven by `ContentState.startedAt`
//  so it ticks on its own without the app pushing per-second updates.
//

import ActivityKit
import SwiftUI
import WidgetKit

struct RecordingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
            // Lock-screen / banner presentation.
            HStack(spacing: 14) {
                indicator(isPaused: context.state.isPaused)

                VStack(alignment: .leading, spacing: 2) {
                    Text(context.state.isPaused ? "Paused" : "Recording")
                        .font(.headline)
                    elapsed(context.state)
                        .font(.system(.title3, design: .rounded)).monospacedDigit()
                        .foregroundStyle(.secondary)
                }

                Spacer()

                HStack(spacing: 12) {
                    Button(intent: ToggleRecordingIntent()) {
                        Image(systemName: context.state.isPaused ? "play.fill" : "pause.fill")
                    }
                    .buttonStyle(.bordered)
                    .tint(.secondary)

                    Button(intent: StopRecordingIntent()) {
                        Image(systemName: "stop.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                }
            }
            .padding()
            .activityBackgroundTint(Color.black.opacity(0.25))

        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    indicator(isPaused: context.state.isPaused)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    elapsed(context.state)
                        .font(.system(.title3, design: .rounded)).monospacedDigit()
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 16) {
                        Button(intent: ToggleRecordingIntent()) {
                            Label(
                                context.state.isPaused ? "Resume" : "Pause",
                                systemImage: context.state.isPaused ? "play.fill" : "pause.fill")
                        }
                        .buttonStyle(.bordered)

                        Button(intent: StopRecordingIntent()) {
                            Label("Stop", systemImage: "stop.fill")
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.red)
                    }
                    .frame(maxWidth: .infinity)
                }
            } compactLeading: {
                indicator(isPaused: context.state.isPaused)
            } compactTrailing: {
                elapsed(context.state).monospacedDigit().frame(maxWidth: 44)
            } minimal: {
                indicator(isPaused: context.state.isPaused)
            }
            .keylineTint(.red)
        }
    }

    @ViewBuilder private func indicator(isPaused: Bool) -> some View {
        Image(systemName: isPaused ? "pause.circle.fill" : "waveform.circle.fill")
            .foregroundStyle(.red)
            .font(.title2)
    }

    /// Ticking elapsed clock while recording; frozen value while paused.
    @ViewBuilder private func elapsed(_ state: RecordingActivityAttributes.ContentState) -> some View {
        if state.isPaused {
            Text(staticElapsed(since: state.startedAt))
        } else {
            Text(state.startedAt, style: .timer)
        }
    }

    private func staticElapsed(since origin: Date) -> String {
        let total = max(0, Int(Date().timeIntervalSince(origin)))
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}
