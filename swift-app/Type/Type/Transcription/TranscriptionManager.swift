//
//  TranscriptionManager.swift
//  Type   (app target only)
//
//  Stage 4 — OPTIONAL, iPhone-native transcription. Turns the audio of a
//  recording note into its body text using Apple's **on-device** Speech
//  recognition (`SFSpeechRecognizer` with `requiresOnDeviceRecognition = true`).
//
//  Why on-device only:
//   * Local-first, like the rest of the app — the audio never leaves the phone,
//     no account, no API key, no Whisper/AssemblyAI dependency.
//   * It matches the desktop's status model exactly: a note moves
//     pending → processing → completed (body = transcript) or → failed (body
//     stays empty), via `NotesStore.updateRecordingTranscription`, which is a
//     direct port of the Rust `update_recording_note_status`. So a transcript
//     produced here is byte-identical to one the desktop would have written, and
//     the same git repo round-trips cleanly.
//
//  It is OFF by default (`WorkspaceSettings.transcriptionEnabled`). When on, a
//  freshly-saved recording is enqueued automatically; the user can also kick a
//  scan of existing pending/failed recordings from Settings.
//
//  This is a single-flight serial queue: one recognition at a time, in the app
//  process. It is intentionally lightweight (no persistence) — the source of
//  truth is the note's `transcription_status` on disk, so a crash mid-run just
//  leaves the note `processing` and a later "Transcribe pending" re-runs it.
//

import Foundation
import Observation
import Speech

@MainActor
@Observable
final class TranscriptionManager {
    static let shared = TranscriptionManager()

    enum State: Equatable { case idle, running }

    private(set) var state: State = .idle
    /// Number of notes still waiting in the queue (excludes the in-flight one).
    private(set) var pendingCount = 0
    /// The note currently being transcribed, if any.
    private(set) var activeNotePath: String?
    private(set) var lastError: String?

    /// Set by `AppState`; fired after every status change so the tree/previews
    /// refresh (so a completed transcript shows up without a manual reload).
    var onUpdated: (() -> Void)?

    private var root: URL?
    private var enabled = false
    private var queue: [String] = []
    private var inFlight = false
    private var task: SFSpeechRecognitionTask?

    private init() {}

    // MARK: Configuration

    /// Point the manager at the active workspace + whether transcription is on.
    /// Disabling drops anything still queued (the in-flight job finishes).
    func configure(root: URL, enabled: Bool) {
        self.root = root
        self.enabled = enabled
        if !enabled {
            queue.removeAll()
            pendingCount = 0
        }
    }

    // MARK: Enqueue

    /// Queue a single recording note (called right after a recording is saved).
    func enqueue(notePath: String) {
        guard enabled else { return }
        if !queue.contains(notePath) { queue.append(notePath) }
        pendingCount = queue.count
        pump()
    }

    /// Scan the workspace and queue every recording that still needs work
    /// (pending / queued / failed, plus `processing` left stranded by a crash).
    /// Used by the Settings "Transcribe pending" action and after a sync pulls in
    /// recordings made on another device. Skips the note currently in flight.
    func enqueuePending() {
        guard enabled, let root else { return }
        let store = NotesStore(root: root)
        let retryable: Set<String> = [
            TranscriptionStatus.pending,
            TranscriptionStatus.queued,
            TranscriptionStatus.processing,
            TranscriptionStatus.failed,
        ]
        for info in store.collectRecordingNotes() where retryable.contains(info.status) {
            if info.notePath == activeNotePath { continue }
            if !queue.contains(info.notePath) { queue.append(info.notePath) }
        }
        pendingCount = queue.count
        pump()
    }

    // MARK: Queue pump

    private func pump() {
        guard enabled, !inFlight, !queue.isEmpty, let root else {
            if queue.isEmpty && !inFlight { state = .idle }
            return
        }
        inFlight = true
        state = .running
        let notePath = queue.removeFirst()
        pendingCount = queue.count
        activeNotePath = notePath
        Task { await process(notePath: notePath, root: root) }
    }

    private func finish() {
        inFlight = false
        task = nil
        activeNotePath = nil
        pump()
    }

    private func process(notePath: String, root: URL) async {
        let store = NotesStore(root: root)

        guard
            let doc = try? store.readDocument(relativePath: notePath),
            doc.frontMatter.type == kRecordingNoteType,
            let audioRel = doc.frontMatter.recordingAudioPath, !audioRel.isEmpty
        else {
            finish()
            return
        }
        let audioURL = store.url(forRelative: audioRel)
        guard FileManager.default.fileExists(atPath: audioURL.path) else {
            setStatus(store, notePath, .failed, error: "Audio file is missing.")
            finish()
            return
        }

        // Mark processing first so the UI (and a desktop watching the repo) sees
        // the work in flight.
        setStatus(store, notePath, .processing, error: nil)

        guard await ensureAuthorized() else {
            setStatus(store, notePath, .failed, error: "Speech recognition isn’t authorized.")
            finish()
            return
        }

        do {
            let transcript = try await recognizeOnDevice(audioURL: audioURL)
            setStatus(store, notePath, .completed, error: nil, transcript: transcript)
            lastError = nil
        } catch {
            let message = (error as? TranscriptionError)?.message ?? error.localizedDescription
            setStatus(store, notePath, .failed, error: message)
            lastError = message
        }
        finish()
    }

    /// The status transitions this engine writes, mapped to the shared
    /// `TranscriptionStatus` string constants (the on-disk values).
    private enum Status {
        case processing, completed, failed
        var raw: String {
            switch self {
            case .processing: return TranscriptionStatus.processing
            case .completed: return TranscriptionStatus.completed
            case .failed: return TranscriptionStatus.failed
            }
        }
    }

    /// Write a status transition and notify so the tree/previews refresh.
    private func setStatus(
        _ store: NotesStore, _ notePath: String, _ status: Status,
        error: String?, transcript: String? = nil
    ) {
        try? store.updateRecordingTranscription(
            relativePath: notePath, status: status.raw,
            error: error, transcriptId: nil, transcript: transcript)
        onUpdated?()
    }

    // MARK: Speech framework

    private func ensureAuthorized() async -> Bool {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: return true
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { status in
                    continuation.resume(returning: status == .authorized)
                }
            }
        default:
            return false
        }
    }

    /// Transcribe a file entirely on-device. Throws `TranscriptionError` when the
    /// device/locale can't do offline recognition — we deliberately do NOT fall
    /// back to Apple's servers, to keep the app local-first.
    private func recognizeOnDevice(audioURL: URL) async throws -> String {
        guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else {
            throw TranscriptionError.unavailable
        }
        guard recognizer.supportsOnDeviceRecognition else {
            throw TranscriptionError.onDeviceUnsupported
        }
        let request = SFSpeechURLRecognitionRequest(url: audioURL)
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = false

        // The result handler is invoked off the main actor, so the single-resume
        // guard lives in a lock-backed box (resuming a continuation twice is a
        // hard crash; with partial results off we expect exactly one callback,
        // but a stray repeat must be ignored, not fatal).
        let gate = ResumeGate()
        return try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<String, Error>) in
            self.task = recognizer.recognitionTask(with: request) { result, error in
                if let error {
                    gate.resume { continuation.resume(throwing: error) }
                    return
                }
                guard let result, result.isFinal else { return }
                let text = result.bestTranscription.formattedString
                gate.resume { continuation.resume(returning: text) }
            }
        }
    }
}

/// Runs its block at most once, safely across threads — used to guard a
/// `CheckedContinuation` against the speech callback firing more than once.
private final class ResumeGate: @unchecked Sendable {
    private let lock = NSLock()
    private var fired = false

    func resume(_ block: () -> Void) {
        lock.lock()
        if fired {
            lock.unlock()
            return
        }
        fired = true
        lock.unlock()
        block()
    }
}

/// User-facing transcription failures (stored in `transcription_error`).
enum TranscriptionError: Error {
    case unavailable
    case onDeviceUnsupported

    var message: String {
        switch self {
        case .unavailable:
            return "On-device speech recognition isn’t available right now."
        case .onDeviceUnsupported:
            return
                "This iPhone can’t transcribe offline for the current language. "
                + "Add the language under Settings ▸ General ▸ Keyboard ▸ Dictation."
        }
    }
}
