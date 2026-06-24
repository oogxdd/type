//
//  SettingsView.swift
//  Type
//
//  Workspace settings. Stage 1 covers the working-directory basics + filename
//  strategy. Git sync (Stage 2) and transcription (Stage 4) add their own
//  sections here.
//

import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var app
    @State private var workspaceName = ""

    private var transcription: TranscriptionManager { TranscriptionManager.shared }

    var body: some View {
        NavigationStack {
            Form {
                Section("Workspace") {
                    TextField("Name", text: $workspaceName)
                        .onSubmit { app.renameActiveWorkspace(workspaceName) }
                    LabeledContent("Notes folder", value: app.activeWorkspace.relativeRoot)
                    LabeledContent(
                        "Location",
                        value: WorkspaceStore.rootURL(for: app.activeWorkspace)
                            .path(percentEncoded: false))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section {
                    Picker("New note filenames", selection: fileNameFormatBinding) {
                        Text("Date + title").tag(NoteFileNameFormat.utcTimestampSlug)
                        Text("Random ID").tag(NoteFileNameFormat.uuidV7)
                        Text("ID + title").tag(NoteFileNameFormat.uuidV7PrefixSlug)
                    }
                } header: {
                    Text("Files")
                } footer: {
                    Text(
                        "Matches the desktop app's filename strategy so synced notes stay consistent."
                    )
                }

                Section("Sync") {
                    NavigationLink {
                        SyncSettingsView()
                    } label: {
                        Label("Git sync", systemImage: "arrow.triangle.2.circlepath")
                    }
                }

                Section {
                    Toggle("On-device transcription", isOn: transcriptionBinding)

                    if app.activeWorkspace.settings.transcriptionEnabled {
                        Button {
                            app.transcribePendingRecordings()
                        } label: {
                            Label("Transcribe pending recordings", systemImage: "waveform")
                        }
                        .disabled(transcription.state == .running)

                        if let status = transcriptionStatusText {
                            LabeledContent("Status", value: status)
                                .foregroundStyle(.secondary)
                                .font(.caption)
                        }
                    }
                } header: {
                    Text("Transcription")
                } footer: {
                    Text(
                        "Transcribes voice notes on this iPhone with Apple's on-device speech recognition — no audio leaves the device, no account needed. Needs a language your iPhone supports offline (add it under Settings ▸ General ▸ Keyboard ▸ Dictation). Notes stay plain Markdown with the same layout as the desktop app, so the same git repository works on both."
                    )
                }
            }
            .navigationTitle("Settings")
            .onAppear { workspaceName = app.activeWorkspace.name }
        }
    }

    private var transcriptionBinding: Binding<Bool> {
        Binding(
            get: { app.activeWorkspace.settings.transcriptionEnabled },
            set: { newValue in
                app.updateActiveSettings { $0.transcriptionEnabled = newValue }
            }
        )
    }

    /// A one-line summary of the transcriber's live state, or nil when idle.
    private var transcriptionStatusText: String? {
        switch transcription.state {
        case .running:
            let queued = transcription.pendingCount
            return queued > 0 ? "Transcribing… (\(queued) queued)" : "Transcribing…"
        case .idle:
            if let error = transcription.lastError { return "Last error: \(error)" }
            return nil
        }
    }

    private var fileNameFormatBinding: Binding<NoteFileNameFormat> {
        Binding(
            get: { app.activeWorkspace.settings.noteFileNameFormat },
            set: { newValue in
                app.updateActiveSettings { $0.noteFileNameFormat = newValue }
            }
        )
    }
}
