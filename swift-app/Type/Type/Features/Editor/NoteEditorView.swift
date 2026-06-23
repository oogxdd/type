//
//  NoteEditorView.swift
//  Type
//
//  Plain-text editor for an existing note. Autosaves the body (debounced 400 ms,
//  matching the desktop) and cleans up a note that is left empty.
//

import SwiftUI

struct NoteEditorView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    let path: String

    @State private var text = ""
    @State private var loaded = false
    @State private var originalWasEmpty = false
    @State private var debouncer = Debouncer(milliseconds: 400)

    var body: some View {
        TextEditor(text: $text)
            .font(.body)
            .lineSpacing(3)
            .scrollContentBackground(.hidden)
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(role: .destructive) {
                        debouncer.cancel()
                        app.deleteNote(path: path)
                        dismiss()
                    } label: {
                        Image(systemName: "trash")
                    }
                }
            }
            .onAppear(perform: load)
            .onChange(of: text) { _, newValue in
                guard loaded else { return }
                debouncer.call { app.saveBody(newValue, path: path) }
            }
            .onDisappear(perform: handleDisappear)
    }

    private var navigationTitle: String {
        let firstLine =
            text.split(separator: "\n", omittingEmptySubsequences: true).first.map(String.init) ?? ""
        let trimmed = firstLine.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { return String(trimmed.prefix(40)) }
        return path.split(separator: "/").last.map(String.init) ?? "Note"
    }

    private func load() {
        guard !loaded else { return }
        if let doc = app.readDocument(path: path) {
            text = doc.body
            originalWasEmpty = doc.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        loaded = true
    }

    private func handleDisappear() {
        guard loaded else { return }
        debouncer.cancel()
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            // Empty-note cleanup (matches desktop): a note left empty is removed.
            // Don't delete recording notes whose body is legitimately empty until
            // transcription completes — those are handled in Stage 3/4.
            if let doc = app.readDocument(path: path), doc.frontMatter.type == kRecordingNoteType {
                app.saveBody(text, path: path)
            } else {
                app.deleteNote(path: path)
            }
        } else {
            app.saveBody(text, path: path)
        }
    }
}
