//
//  RecordWidget.swift
//  Type Record Widget   (widget extension target)
//
//  The static home-screen + lock-screen widgets. Two start paths, by surface:
//   • Home screen (`systemSmall`) and `accessoryCircular`: a `.widgetURL` deep
//     link (`type://record`) that foregrounds the app and auto-starts — the most
//     reliable "tap → recording" path.
//   • `accessoryRectangular` (lock screen): an interactive `Button(intent:)` that
//     runs `StartRecordingIntent` so recording can begin without unlocking.
//
//  The view reflects live state read from the App Group (`RecordingBridge`) so the
//  widget shows a red "Recording" affordance while capture is running.
//

import SwiftUI
import WidgetKit

struct RecordEntry: TimelineEntry {
    let date: Date
    let isRecording: Bool
}

struct RecordProvider: TimelineProvider {
    func placeholder(in context: Context) -> RecordEntry {
        RecordEntry(date: Date(), isRecording: false)
    }

    func getSnapshot(in context: Context, completion: @escaping (RecordEntry) -> Void) {
        completion(RecordEntry(date: Date(), isRecording: RecordingBridge.readState().isRecording))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<RecordEntry>) -> Void) {
        let entry = RecordEntry(date: Date(), isRecording: RecordingBridge.readState().isRecording)
        // The app reloads timelines on every state change; a far-future refresh is
        // just a safety net.
        completion(Timeline(entry: entry, policy: .after(Date().addingTimeInterval(3600))))
    }
}

// Literal so the widget target needn't import the app's `AppConstants`. Must
// match `AppConstants.urlScheme` + the `CFBundleURLTypes` scheme on the app.
private let recordDeepLink = URL(string: "type://record")!

struct RecordWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    var entry: RecordEntry

    var body: some View {
        switch family {
        case .accessoryCircular:
            circular
        case .accessoryRectangular:
            rectangular
        default:
            home
        }
    }

    // Home-screen small widget — whole surface deep-links in.
    private var home: some View {
        VStack(spacing: 10) {
            ZStack {
                Circle().fill(.red.opacity(entry.isRecording ? 0.25 : 0.15))
                    .frame(width: 64, height: 64)
                Image(systemName: entry.isRecording ? "waveform" : "mic.fill")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(.red)
            }
            Text(entry.isRecording ? "Recording…" : "New Recording")
                .font(.caption).fontWeight(.medium)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .containerBackground(.fill.tertiary, for: .widget)
        .widgetURL(recordDeepLink)
    }

    private var circular: some View {
        ZStack {
            AccessoryWidgetBackground()
            Image(systemName: entry.isRecording ? "waveform" : "mic.fill")
                .font(.system(size: 20, weight: .semibold))
        }
        .widgetURL(recordDeepLink)
    }

    private var rectangular: some View {
        HStack {
            Label(
                entry.isRecording ? "Recording" : "New Recording",
                systemImage: entry.isRecording ? "waveform" : "mic.fill"
            )
            .font(.headline)
            Spacer()
            // Interactive button → starts without unlocking.
            Button(intent: StartRecordingIntent()) {
                Image(systemName: "record.circle")
            }
            .buttonStyle(.plain)
        }
    }
}

struct RecordWidget: Widget {
    let kind = "TypeRecordWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: RecordProvider()) { entry in
            RecordWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Quick Record")
        .description("Start a voice note in Type.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular])
    }
}
