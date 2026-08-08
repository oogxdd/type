import SwiftUI
import WidgetKit

// Entry point of the WidgetKit extension. It contains only the recording Live
// Activity — there is no Home Screen widget.
@main
struct RecordingActivityWidgetBundle: WidgetBundle {
  var body: some Widget {
    if #available(iOS 16.2, *) {
      RecordingLiveActivityWidget()
    }
  }
}
