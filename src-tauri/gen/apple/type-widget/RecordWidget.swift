import WidgetKit
import SwiftUI

struct RecordWidgetEntry: TimelineEntry {
    let date: Date
}

struct RecordWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> RecordWidgetEntry {
        RecordWidgetEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (RecordWidgetEntry) -> Void) {
        completion(RecordWidgetEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<RecordWidgetEntry>) -> Void) {
        let entry = RecordWidgetEntry(date: Date())
        let timeline = Timeline(entries: [entry], policy: .never)
        completion(timeline)
    }
}

struct RecordWidgetView: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "mic.fill")
                .font(.system(size: 28))
                .foregroundColor(.red)
            Text("New Recording")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.primary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .widgetURL(URL(string: "type2://record")!)
    }
}

@main
struct RecordWidget: Widget {
    let kind: String = "RecordWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: RecordWidgetProvider()) { _ in
            RecordWidgetView()
        }
        .configurationDisplayName("Quick Record")
        .description("Tap to start a new recording in Type.")
        .supportedFamilies([.systemSmall])
    }
}
