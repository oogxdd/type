//
//  RecordIntents.swift
//  Type Record Widget   (widget extension target)
//
//  App Intents the lock-screen / Control-Center surfaces invoke. They never touch
//  the recorder directly — they drop a command into the App Group + poke the app
//  (`RecordingBridge`), which captures audio in its own process (it owns the
//  AVAudioSession + background-audio entitlement).
//
//  Why these specific intent protocols:
//   • `AudioRecordingIntent` (iOS 18+) tells the system this intent starts audio
//     capture, so iOS will wake the app in the background WITH microphone
//     privileges even from the lock screen — the mechanism that lets recording
//     begin without unlocking (same capability the system Voice Memos control
//     uses). `openAppWhenRun = false` keeps it backgrounded.
//   • `LiveActivityIntent` is the right type for buttons hosted inside a running
//     Live Activity (pause / stop); the app is already alive holding the session.
//

import AppIntents
import WidgetKit

/// Start recording from a lock-screen control / accessory button, without
/// unlocking. Conforms to `AudioRecordingIntent` so iOS grants background mic.
struct StartRecordingIntent: AudioRecordingIntent {
    static let title: LocalizedStringResource = "Start recording"
    static let description = IntentDescription("Begin a new voice note.")
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        RecordingBridge.send(.start)
        return .result()
    }
}

/// Stop + save the in-progress recording (Live Activity / control).
struct StopRecordingIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Stop recording"
    static let description = IntentDescription("Stop and save the voice note.")
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        RecordingBridge.send(.stop)
        return .result()
    }
}

/// Pause / resume the in-progress recording (Live Activity).
struct ToggleRecordingIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Pause or resume recording"
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        RecordingBridge.send(.toggle)
        return .result()
    }
}

/// The toggle behind the Control-Center / lock-screen Control widget. Conforms to
/// `AudioRecordingIntent` so turning it ON can start capture from the lock screen.
struct RecordingControlToggleIntent: SetValueIntent, AudioRecordingIntent {
    static let title: LocalizedStringResource = "Toggle recording"
    static let openAppWhenRun = false

    @Parameter(title: "Recording")
    var value: Bool

    func perform() async throws -> some IntentResult {
        RecordingBridge.send(value ? .start : .stop)
        return .result()
    }
}
