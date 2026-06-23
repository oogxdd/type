//
//  RecordWidgetBundle.swift
//  Type Record Widget   (widget extension target)
//
//  The extension's entry point. Bundles every surface: the static home-screen /
//  lock-screen widgets, the Control-Center control, and the recording Live
//  Activity.
//

import SwiftUI
import WidgetKit

@main
struct RecordWidgetBundle: WidgetBundle {
    var body: some Widget {
        RecordWidget()
        RecordControl()
        RecordingLiveActivity()
    }
}
