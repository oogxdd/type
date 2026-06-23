//
//  AudioRecorder.swift
//  Type   (app target only)
//
//  The one place audio is captured. Recording ALWAYS happens here, in the app
//  process, because only the app owns the `AVAudioSession` and the `audio`
//  background mode that keeps capture alive on the lock screen — a widget
//  extension can't reliably hold the mic.
//
//  Two ways recording gets driven:
//   1. In-app UI (RecordingView) and the home-screen widget deep link
//      (`type://record`) call `start()/stop()` directly on this singleton.
//   2. Lock-screen surfaces (Live Activity buttons, Control widget) can't reach
//      this object across the process boundary, so they post a `RecordingBridge`
//      command + Darwin poke; we observe that here and react. This is how a
//      recording is paused/stopped from the lock screen WITHOUT unlocking — the
//      app is already alive in the background holding the audio session, exactly
//      like the system Voice Memos app.
//
//  On stop, a recording note is written in the desktop's exact `audio_recording`
//  front-matter shape (see `NotesStore.createRecordingNote`) so it round-trips
//  through the same git repo.
//

import AVFoundation
import ActivityKit
import Foundation
import Observation
import WidgetKit

@MainActor
@Observable
final class AudioRecorder: NSObject {
    static let shared = AudioRecorder()

    enum State: Equatable { case idle, recording, paused }

    private(set) var state: State = .idle
    /// Origin for the elapsed-time clock (already adjusted for paused gaps).
    private(set) var timerOrigin: Date?
    private(set) var lastError: String?

    /// Set by `AppState` so the new note is opened + the tree refreshed.
    var onSaved: ((String) -> Void)?

    // Configured by AppState (recording runs in-app, so we read the live root
    // directly rather than through the App Group).
    private var notesRoot: URL?
    private var fileNameFormat: NoteFileNameFormat = .utcTimestampSlug
    private var targetFolder = NotesLayout.feedFolder
    private var workspaceName = "Type"

    private var recorder: AVAudioRecorder?
    private var currentAudioRelative: String?
    private var accumulated: TimeInterval = 0
    private var segmentStart: Date?
    private var activity: Activity<RecordingActivityAttributes>?
    private var observerInstalled = false

    var isRecording: Bool { state != .idle }

    // MARK: Configuration

    /// Point the recorder at the active workspace. Safe to call repeatedly; it
    /// also installs the cross-process command observer on first call.
    func configure(
        root: URL, format: NoteFileNameFormat, folder: String, workspaceName: String
    ) {
        self.notesRoot = root
        self.fileNameFormat = format
        self.targetFolder = folder.isEmpty ? NotesLayout.feedFolder : folder
        self.workspaceName = workspaceName
        installBridgeObserverIfNeeded()
    }

    func setTargetFolder(_ folder: String) {
        targetFolder = folder.isEmpty ? NotesLayout.feedFolder : folder
    }

    // MARK: Public controls

    func toggleFromUI() {
        switch state {
        case .idle: start()
        case .recording, .paused: stopAndSave()
        }
    }

    func start() {
        guard state == .idle else { return }
        guard let root = notesRoot else {
            lastError = "No workspace configured."
            return
        }
        requestPermission { [weak self] granted in
            guard let self else { return }
            guard granted else {
                self.lastError = "Microphone access denied."
                return
            }
            self.beginCapture(root: root)
        }
    }

    func pause() {
        guard state == .recording, let recorder else { return }
        recorder.pause()
        if let segmentStart { accumulated += Date().timeIntervalSince(segmentStart) }
        segmentStart = nil
        state = .paused
        publishState()
        updateActivity()
    }

    func resume() {
        guard state == .paused, let recorder else { return }
        recorder.record()
        segmentStart = Date()
        timerOrigin = Date().addingTimeInterval(-accumulated)
        state = .recording
        publishState()
        updateActivity()
    }

    func toggle() {
        switch state {
        case .recording: pause()
        case .paused: resume()
        case .idle: start()
        }
    }

    /// Stop, write the recording note, and notify.
    func stopAndSave() {
        guard state != .idle, let recorder, let root = notesRoot,
            let audioRelative = currentAudioRelative
        else {
            resetToIdle(endActivity: true)
            return
        }
        recorder.stop()
        self.recorder = nil

        let store = NotesStore(root: root)
        do {
            let notePath = try store.createRecordingNote(
                folderRelative: targetFolder,
                audioRelativePath: audioRelative,
                format: fileNameFormat
            )
            onSaved?(notePath)
        } catch {
            lastError = error.localizedDescription
        }
        resetToIdle(endActivity: true)
    }

    /// Stop and discard the audio (no note written).
    func cancel() {
        if let recorder {
            let url = recorder.url
            recorder.stop()
            try? FileManager.default.removeItem(at: url)
        }
        recorder = nil
        currentAudioRelative = nil
        resetToIdle(endActivity: true)
    }

    // MARK: Capture internals

    private func beginCapture(root: URL) {
        do {
            try configureSession()
            let store = NotesStore(root: root)
            let (url, relative) = try store.allocateAudioFile(extension: "m4a")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            ]
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.delegate = self
            guard recorder.record() else {
                lastError = "Failed to start recording."
                try? FileManager.default.removeItem(at: url)
                return
            }
            self.recorder = recorder
            self.currentAudioRelative = relative
            self.accumulated = 0
            self.segmentStart = Date()
            self.timerOrigin = Date()
            self.state = .recording
            self.lastError = nil
            publishState()
            startActivity()
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func configureSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .playAndRecord, mode: .default,
            options: [.allowBluetooth, .defaultToSpeaker, .duckOthers])
        try session.setActive(true, options: [])
    }

    private func requestPermission(_ completion: @escaping (Bool) -> Void) {
        AVAudioApplication.requestRecordPermission { granted in
            Task { @MainActor in completion(granted) }
        }
    }

    private func resetToIdle(endActivity: Bool) {
        state = .idle
        timerOrigin = nil
        segmentStart = nil
        accumulated = 0
        currentAudioRelative = nil
        if endActivity { self.endActivity() }
        publishState()
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    // MARK: Cross-process command bridge

    private func installBridgeObserverIfNeeded() {
        guard !observerInstalled else { return }
        observerInstalled = true
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        CFNotificationCenterAddObserver(
            center,
            Unmanaged.passUnretained(self).toOpaque(),
            { _, _, _, _, _ in
                // C callback: no captures allowed. Hop to the main actor and read
                // the queued command from the shared App Group.
                Task { @MainActor in AudioRecorder.shared.handleBridgeCommand() }
            },
            RecordingSignal.command.name as CFString,
            nil,
            .deliverImmediately)
    }

    /// Drain whatever command a widget surface queued.
    func handleBridgeCommand() {
        guard let pending = RecordingBridge.takeCommand() else { return }
        if let folder = pending.folder, !folder.isEmpty { setTargetFolder(folder) }
        switch pending.command {
        case .start: start()
        case .stop: stopAndSave()
        case .toggle: toggle()
        case .cancel: cancel()
        }
    }

    private func publishState() {
        RecordingBridge.publish(
            RecordingPublishedState(
                isRecording: isRecording,
                isPaused: state == .paused,
                startedAt: timerOrigin),
            workspaceName: workspaceName)
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: Live Activity (lock-screen surface)

    private func startActivity() {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let attributes = RecordingActivityAttributes(workspaceName: workspaceName)
        let content = ActivityContent(
            state: .init(startedAt: timerOrigin ?? Date(), isPaused: false),
            staleDate: nil)
        activity = try? Activity.request(
            attributes: attributes, content: content, pushType: nil)
    }

    private func updateActivity() {
        guard let activity else { return }
        let content = ActivityContent(
            state: .init(startedAt: timerOrigin ?? Date(), isPaused: state == .paused),
            staleDate: nil)
        Task { await activity.update(content) }
    }

    private func endActivity() {
        guard let activity else { return }
        let final = ActivityContent(
            state: .init(startedAt: timerOrigin ?? Date(), isPaused: true),
            staleDate: nil)
        Task { await activity.end(final, dismissalPolicy: .immediate) }
        self.activity = nil
    }
}

extension AudioRecorder: AVAudioRecorderDelegate {
    nonisolated func audioRecorderDidFinishRecording(
        _ recorder: AVAudioRecorder, successfully flag: Bool
    ) {
        // Interruptions (e.g. a phone call) finish the recorder out from under us.
        Task { @MainActor in
            if AudioRecorder.shared.state != .idle && !flag {
                AudioRecorder.shared.lastError = "Recording was interrupted."
            }
        }
    }
}
