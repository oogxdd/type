//
//  RecordingView.swift
//  Type
//
//  The in-app recording screen. It's a thin SwiftUI shell over the shared
//  `AudioRecorder.shared` engine (the same engine the lock-screen surfaces
//  drive), so state stays consistent no matter where a recording was started.
//
//  Auto-start: when the home-screen widget deep link (`type://record`) sets
//  `AppState.pendingRecordIntent`, RootView switches here and we begin capture
//  immediately — "tap widget → recording" with no extra step.
//

import SwiftUI

struct RecordingView: View {
    @Environment(AppState.self) private var app
    private var recorder: AudioRecorder { AudioRecorder.shared }

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()

                statusText
                timer

                Spacer()

                controls
                    .padding(.bottom, 24)

                if let error = recorder.lastError {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
            }
            .padding()
            .navigationTitle("Record")
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear(perform: consumePendingIntent)
        .onChange(of: app.pendingRecordIntent) { _, pending in
            if pending { consumePendingIntent() }
        }
    }

    // MARK: Pieces

    private var statusText: some View {
        Text(statusLabel)
            .font(.headline)
            .foregroundStyle(recorder.state == .recording ? .red : .secondary)
    }

    private var statusLabel: String {
        switch recorder.state {
        case .idle: "Tap to record"
        case .recording: "Recording…"
        case .paused: "Paused"
        }
    }

    @ViewBuilder private var timer: some View {
        if let origin = recorder.timerOrigin {
            Group {
                if recorder.state == .recording {
                    Text(origin, style: .timer)
                } else {
                    Text(Self.elapsed(since: origin))
                }
            }
            .font(.system(size: 56, weight: .light, design: .rounded))
            .monospacedDigit()
            .contentTransition(.numericText())
        } else {
            Text("00:00")
                .font(.system(size: 56, weight: .light, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.tertiary)
        }
    }

    @ViewBuilder private var controls: some View {
        switch recorder.state {
        case .idle:
            recordButton
        case .recording, .paused:
            HStack(spacing: 40) {
                pauseResumeButton
                stopButton
            }
        }
    }

    private var recordButton: some View {
        Button(action: { recorder.start() }) {
            ZStack {
                Circle().fill(.red.opacity(0.15)).frame(width: 96, height: 96)
                Circle().fill(.red).frame(width: 72, height: 72)
                Image(systemName: "mic.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(.white)
            }
        }
        .accessibilityLabel("Start recording")
    }

    private var stopButton: some View {
        Button(action: { recorder.stopAndSave() }) {
            ZStack {
                Circle().stroke(.red, lineWidth: 4).frame(width: 80, height: 80)
                RoundedRectangle(cornerRadius: 6).fill(.red).frame(width: 30, height: 30)
            }
        }
        .accessibilityLabel("Stop and save")
    }

    private var pauseResumeButton: some View {
        Button(action: { recorder.toggle() }) {
            ZStack {
                Circle().fill(.secondary.opacity(0.15)).frame(width: 64, height: 64)
                Image(systemName: recorder.state == .paused ? "play.fill" : "pause.fill")
                    .font(.system(size: 24))
                    .foregroundStyle(.primary)
            }
        }
        .accessibilityLabel(recorder.state == .paused ? "Resume" : "Pause")
    }

    // MARK: Helpers

    private func consumePendingIntent() {
        guard app.pendingRecordIntent else { return }
        app.pendingRecordIntent = false
        if recorder.state == .idle { recorder.start() }
    }

    private static func elapsed(since origin: Date) -> String {
        let total = max(0, Int(Date().timeIntervalSince(origin)))
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}
