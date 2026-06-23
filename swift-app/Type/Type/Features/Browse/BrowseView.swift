//
//  BrowseView.swift
//  Type
//
//  Feed (newest-first) + folder navigation. Tap a note to edit it, tap a folder
//  to drill in. The "+" creates a folder at the current level.
//

import SwiftUI

enum BrowseRoute: Hashable {
    case note(String)
    case folder(String)
}

struct BrowseView: View {
    @Environment(AppState.self) private var app
    @State private var path = NavigationPath()
    @State private var feed: [NotePreview] = []
    @State private var showNewFolderPrompt = false
    @State private var newFolderName = ""

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if !feed.isEmpty {
                    Section("Feed") {
                        ForEach(feed) { preview in
                            NavigationLink(value: BrowseRoute.note(preview.path)) {
                                NotePreviewRow(preview: preview)
                            }
                        }
                    }
                }

                Section("Folders") {
                    ForEach(app.browsableTopFolders) { folder in
                        NavigationLink(value: BrowseRoute.folder(folder.path)) {
                            Label(folder.name, systemImage: folderIcon(folder.name))
                        }
                    }
                }
            }
            .navigationTitle(app.activeWorkspace.name)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        newFolderName = ""
                        showNewFolderPrompt = true
                    } label: {
                        Image(systemName: "folder.badge.plus")
                    }
                }
            }
            .navigationDestination(for: BrowseRoute.self) { route in
                switch route {
                case .note(let notePath):
                    NoteEditorView(path: notePath)
                case .folder(let folderPath):
                    FolderDetailView(path: folderPath, navigationPath: $path)
                }
            }
            .alert("New folder", isPresented: $showNewFolderPrompt) {
                TextField("Name", text: $newFolderName)
                Button("Cancel", role: .cancel) {}
                Button("Create") {
                    app.createFolder(parent: "", name: newFolderName)
                }
            }
            .onAppear(perform: reload)
            .refreshable { reload() }
        }
    }

    private func reload() {
        app.refreshTree()
        feed = app.feedPreviews
    }

    private func folderIcon(_ name: String) -> String {
        name == NotesLayout.archiveFolder ? "archivebox" : "folder"
    }
}

struct NotePreviewRow: View {
    let preview: NotePreview

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                if preview.isRecording {
                    Image(systemName: "waveform")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(preview.title)
                    .font(.body)
                    .lineLimit(1)
            }
            if !preview.snippet.isEmpty {
                Text(preview.snippet)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            if let created = preview.createdMs {
                Text(RelativeDate.string(fromMs: created))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
    }
}

enum RelativeDate {
    nonisolated static func string(fromMs ms: Int64) -> String {
        let date = Date(timeIntervalSince1970: Double(ms) / 1000)
        return formatter.localizedString(for: date, relativeTo: Date())
    }
    nonisolated private static let formatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f
    }()
}
