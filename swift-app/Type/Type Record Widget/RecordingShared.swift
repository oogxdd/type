//
//  RecordingShared.swift
//  Type  +  Type Record Widget   (DUPLICATED — keep both copies identical)
//
//  The cross-process contract between the app and the widget/Live-Activity
//  extension. Both targets compile their own copy of this file (Xcode's
//  file-system-synchronized groups don't share membership across targets, and
//  there's no reliable way to cross-add a single file). If you change one copy,
//  change the other:
//
//      Type/Type/Recording/Shared/RecordingShared.swift          (app)
//      Type/Type Record Widget/RecordingShared.swift             (widget)
//
//  How it's used:
//   • Recording always runs in the APP process (it owns the AVAudioSession +
//     the `audio` background mode). The widget never captures audio itself.
//   • A widget button (Live Activity / Control) can't touch the app's recorder
//     directly, so it drops a *command* into the shared App Group and pokes a
//     Darwin notification. The app observes that, reads the command, and acts.
//   • The app publishes recording *state* back into the App Group so the
//     Control widget can render the right on/off value.
//

import Foundation

/// Shared identifiers + the App Group defaults bridge.
enum RecordingShared {
    /// MUST match the App Group capability enabled on BOTH targets.
    static let appGroupId = AppGroupConstant.identifier

    // Keys inside the shared UserDefaults suite.
    fileprivate static let kPendingCommand = "recording.pendingCommand"
    fileprivate static let kCommandFolder = "recording.commandFolder"
    fileprivate static let kCommandNonce = "recording.commandNonce"
    fileprivate static let kIsRecording = "recording.isRecording"
    fileprivate static let kIsPaused = "recording.isPaused"
    fileprivate static let kStartedAt = "recording.startedAt"
    fileprivate static let kWorkspaceName = "recording.workspaceName"

    static var defaults: UserDefaults? { UserDefaults(suiteName: appGroupId) }
}

/// The App Group identifier as a plain constant so the widget copy doesn't need
/// the app's `AppConstants`. Keep equal to `AppConstants.appGroupIdentifier`.
enum AppGroupConstant {
    static let identifier = "group.com.digital.Type"
}

/// Commands a widget surface can ask the app to perform.
enum RecordingCommand: String {
    case start
    case stop
    case toggle   // pause if recording, resume if paused
    case cancel   // stop + discard (no note written)
}

/// Snapshot of what the app is currently doing, for widget rendering.
struct RecordingPublishedState {
    var isRecording: Bool
    var isPaused: Bool
    var startedAt: Date?
}

/// Reads/writes the shared App Group state. Pure data + a Darwin poke; no UI.
enum RecordingBridge {

    // MARK: Widget → app (commands)

    /// Drop a command for the app to pick up, then poke it awake.
    static func send(_ command: RecordingCommand, folder: String? = nil) {
        guard let defaults = RecordingShared.defaults else { return }
        defaults.set(command.rawValue, forKey: RecordingShared.kPendingCommand)
        defaults.set(folder, forKey: RecordingShared.kCommandFolder)
        // A monotonically increasing nonce so the app can tell a fresh command
        // from a re-delivered Darwin notification.
        let nonce = defaults.integer(forKey: RecordingShared.kCommandNonce) + 1
        defaults.set(nonce, forKey: RecordingShared.kCommandNonce)
        RecordingSignal.command.post()
    }

    /// Pull (and clear) the pending command. Returns nil if none.
    static func takeCommand() -> (command: RecordingCommand, folder: String?)? {
        guard let defaults = RecordingShared.defaults,
            let raw = defaults.string(forKey: RecordingShared.kPendingCommand),
            let command = RecordingCommand(rawValue: raw)
        else { return nil }
        let folder = defaults.string(forKey: RecordingShared.kCommandFolder)
        defaults.removeObject(forKey: RecordingShared.kPendingCommand)
        defaults.removeObject(forKey: RecordingShared.kCommandFolder)
        return (command, folder)
    }

    // MARK: App → widget (state)

    static func publish(_ state: RecordingPublishedState, workspaceName: String? = nil) {
        guard let defaults = RecordingShared.defaults else { return }
        defaults.set(state.isRecording, forKey: RecordingShared.kIsRecording)
        defaults.set(state.isPaused, forKey: RecordingShared.kIsPaused)
        if let started = state.startedAt {
            defaults.set(started.timeIntervalSince1970, forKey: RecordingShared.kStartedAt)
        } else {
            defaults.removeObject(forKey: RecordingShared.kStartedAt)
        }
        if let name = workspaceName {
            defaults.set(name, forKey: RecordingShared.kWorkspaceName)
        }
    }

    static func readState() -> RecordingPublishedState {
        guard let defaults = RecordingShared.defaults else {
            return RecordingPublishedState(isRecording: false, isPaused: false, startedAt: nil)
        }
        let epoch = defaults.double(forKey: RecordingShared.kStartedAt)
        return RecordingPublishedState(
            isRecording: defaults.bool(forKey: RecordingShared.kIsRecording),
            isPaused: defaults.bool(forKey: RecordingShared.kIsPaused),
            startedAt: epoch > 0 ? Date(timeIntervalSince1970: epoch) : nil
        )
    }

    static var workspaceName: String {
        RecordingShared.defaults?.string(forKey: RecordingShared.kWorkspaceName) ?? "Type"
    }
}

/// A single Darwin notification used to poke the app when a command lands. Darwin
/// notifications carry only a name (no payload), so the payload lives in the App
/// Group defaults above; this is purely the wake-up.
struct RecordingSignal {
    let name: String
    static let command = RecordingSignal(name: "com.digital.Type.recording.command")

    func post() {
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        CFNotificationCenterPostNotification(
            center, CFNotificationName(name as CFString), nil, nil, true)
    }
}
