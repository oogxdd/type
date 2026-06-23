//
//  FolderDetailView.swift
//  Type
//
//  A single folder: its subfolders and notes, with actions to create a note (and
//  jump straight into it) or a subfolder. Notes here follow the persisted
//  `.notes-order.json` order.
//

import SwiftUI

struct FolderDetailView: View {
    @Environment(AppState.self) private var app
    let path: String
    @Binding var navigationPath: NavigationPath

    @State private var notes: [NotePreview] = []
    @State private var showNewFolderPrompt = false
    @State private var newFolderName = ""

    private var node: FolderTree? { app.folderNode(at: path) }
    private var isProtected: Bool { NotesLayout.protectedFolders.contains(path) }

    var body: some View {
        List {
            if let node, !node.folders.isEmpty {
                Section("Folders") {
                    ForEach(node.folders) { folder in
                        NavigationLink(value: BrowseRoute.folder(folder.path)) {
                            Label(folder.name, systemImage: "folder")
                        }
                    }
                    .onDelete { offsets in deleteFolders(offsets, in: node) }
                }
            }

            Section("Notes") {
                if notes.isEmpty {
                    Text("No notes yet")
                        .foregroundStyle(.secondary)
                }
                ForEach(notes) { preview in
                    NavigationLink(value: BrowseRoute.note(preview.path)) {
                        NotePreviewRow(preview: preview)
                    }
                }
                .onDelete(perform: deleteNotes)
            }
        }
        .navigationTitle(node?.name ?? "Folder")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    newFolderName = ""
                    showNewFolderPrompt = true
                } label: {
                    Image(systemName: "folder.badge.plus")
                }
                Button {
                    if let newPath = app.createNote(inFolder: path) {
                        reload()
                        navigationPath.append(BrowseRoute.note(newPath))
                    }
                } label: {
                    Image(systemName: "square.and.pencil")
                }
            }
        }
        .alert("New folder", isPresented: $showNewFolderPrompt) {
            TextField("Name", text: $newFolderName)
            Button("Cancel", role: .cancel) {}
            Button("Create") { app.createFolder(parent: path, name: newFolderName) }
        }
        .onAppear(perform: reload)
    }

    private func reload() {
        app.refreshTree()
        notes = app.previews(forFolderPath: path)
    }

    private func deleteNotes(_ offsets: IndexSet) {
        for index in offsets { app.deleteNote(path: notes[index].path) }
        reload()
    }

    private func deleteFolders(_ offsets: IndexSet, in node: FolderTree) {
        for index in offsets {
            let folder = node.folders[index]
            if NotesLayout.protectedFolders.contains(folder.path) { continue }
            app.deleteFolder(path: folder.path)
        }
        reload()
    }
}
