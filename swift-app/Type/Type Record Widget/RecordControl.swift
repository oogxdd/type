//
//  RecordControl.swift
//  Type Record Widget   (widget extension target)
//
//  A Control widget (iOS 18+) for Control Center / the lock screen / the Action
//  button. It's a toggle: ON starts a recording, OFF stops + saves. The toggle's
//  action intent conforms to `AudioRecordingIntent`, which is what lets capture
//  begin from the lock screen without unlocking. Current state is read back from
//  the App Group so the toggle reflects whether the app is actually recording.
//

import AppIntents
import SwiftUI
import WidgetKit

struct RecordControl: ControlWidget {
    static let kind = "com.digital.Type.RecordControl"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetToggle(
                "Record",
                isOn: RecordingBridge.readState().isRecording,
                action: RecordingControlToggleIntent()
            ) { isOn in
                Label(isOn ? "Recording" : "Record", systemImage: isOn ? "waveform" : "mic.fill")
            }
            .tint(.red)
        }
        .displayName("Quick Record")
        .description("Start or stop a voice note in Type.")
    }
}
