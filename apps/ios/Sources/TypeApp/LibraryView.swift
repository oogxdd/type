import SwiftUI
import TypeDomain

struct LibraryView: View {
    @Bindable var model: NotesModel
    @State private var selection = "_system/stream"
    @State private var showFolders = false

    private var folder: Folder? { model.tree?.find(selection) }
    private var title: String { selection == "_system/stream" ? "Stream" : folder?.name ?? "Notes" }

    var body: some View {
        NavigationStack {
            List {
                if let error = model.error { Text(error).foregroundStyle(.red) }
                ForEach(folder?.notes ?? []) { note in
                    Button { Task { await model.open(note) } } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(model.summaries[note.path]?.title.nonEmpty ?? "Untitled")
                                .font(.body.weight(.medium)).lineLimit(2)
                            if let line = model.summaries[note.path]?.second_line, !line.isEmpty {
                                Text(line).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                            }
                        }.padding(.vertical, 6).frame(maxWidth: .infinity, alignment: .leading)
                    }.foregroundStyle(.primary)
                }
            }
            .overlay {
                if model.tree == nil && model.error == nil { ProgressView() }
                else if folder?.notes.isEmpty != false && model.error == nil {
                    ContentUnavailableView("No notes yet", systemImage: "square.and.pencil",
                                           description: Text("Create a note to start writing."))
                }
            }
            .listStyle(.plain)
            .navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Folders", systemImage: "folder") { showFolders = true }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("New note", systemImage: "square.and.pencil") { model.newNote(folder: selection) }
                        .disabled(model.isBusy || model.tree == nil)
                }
            }
            .refreshable { await model.refresh() }
            .task { await model.start() }
            .sheet(isPresented: $showFolders) {
                NavigationStack {
                    List {
                        if let root = model.tree { folderRows(root) }
                    }
                    .navigationTitle("Folders")
                    .toolbar { Button("Done") { showFolders = false } }
                }
            }
            .fullScreenCover(isPresented: Binding(get: { model.draft != nil }, set: { _ in })) {
                EditorView(model: model).interactiveDismissDisabled()
            }
        }
    }

    private func folderRows(_ root: Folder) -> some View {
        // Rust already filters internal storage; retain its persisted folder order.
        func flatten(_ folder: Folder, depth: Int) -> [(Folder, Int)] {
            [(folder, depth)] + folder.children.flatMap { flatten($0, depth: depth + 1) }
        }
        return ForEach(flatten(root, depth: 0), id: \.0.path) { folder, depth in
            Button {
                selection = folder.path
                showFolders = false
            } label: {
                Label(folder.path.isEmpty ? "Notes" : folder.path == "_system/stream" ? "Stream" : folder.name,
                      systemImage: selection == folder.path ? "checkmark" : "folder")
                    .padding(.leading, CGFloat(depth * 14))
            }
        }
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}

private struct EditorView: View {
    @Bindable var model: NotesModel
    @FocusState private var focused: Bool
    @State private var confirmDiscard = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let error = model.error {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(error).font(.callout).foregroundStyle(.red)
                        HStack {
                            Button("Retry save") { Task { await model.flush() } }
                            if let body = model.draft?.body { ShareLink("Export draft", item: body) }
                            Button("Discard", role: .destructive) { confirmDiscard = true }
                                .disabled(model.isSaving || model.isBusy)
                        }
                    }.padding().frame(maxWidth: .infinity, alignment: .leading)
                }
                TextEditor(text: Binding(get: { model.draft?.body ?? "" }, set: { model.edit($0) }))
                    .font(.body).padding(.horizontal, 16).focused($focused)
                    .disabled(model.isBusy).accessibilityIdentifier("noteEditor")
            }
            .navigationTitle(model.draft?.path == nil ? "New note" : "Note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Text(model.isSaving ? "Saving…" : model.draft?.isDirty == true ? "Unsaved" : "Saved")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { Task { await model.close() } }.disabled(model.isBusy)
                }
            }
            .onAppear { focused = model.draft?.path == nil }
            .confirmationDialog("Discard your unsaved changes?", isPresented: $confirmDiscard,
                                titleVisibility: .visible) {
                Button("Discard changes", role: .destructive) { Task { await model.discardDraft() } }
            } message: { Text("The saved note will stay unchanged.") }
        }
    }
}
