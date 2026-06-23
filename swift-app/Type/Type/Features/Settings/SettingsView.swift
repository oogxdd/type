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

                Section {
                    LabeledContent("Git sync", value: "Stage 2")
                    LabeledContent("Voice recording", value: "Stage 3")
                    LabeledContent("Transcription", value: "Stage 4")
                } header: {
                    Text("Coming next")
                } footer: {
                    Text(
                        "Notes are stored as plain Markdown with the same front-matter and folder layout as the desktop app, so the same git repository works on both."
                    )
                }
            }
            .navigationTitle("Settings")
            .onAppear { workspaceName = app.activeWorkspace.name }
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
