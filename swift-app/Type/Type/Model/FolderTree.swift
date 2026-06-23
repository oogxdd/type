//
//  FolderTree.swift
//  Type
//
//  In-memory representation of the notes folder tree shown in the UI, plus the
//  lightweight per-note preview used by the feed / note lists.
//

import Foundation

/// A reference to a note file (name + root-relative, forward-slash path).
struct NoteRef: Identifiable, Hashable {
    var name: String
    var path: String
    var id: String { path }
}

/// A folder node. The root node has an empty `path` and the display name "Notes".
struct FolderTree: Identifiable, Hashable {
    var name: String
    var path: String
    var folders: [FolderTree]
    var notes: [NoteRef]

    var id: String { path.isEmpty ? "__root__" : path }
    var isRoot: Bool { path.isEmpty }
}

/// A parsed, display-ready preview of a note. Cheap enough to build for a whole
/// folder; the feed sorts by `createdMs`.
struct NotePreview: Identifiable, Hashable {
    var path: String
    var fileName: String
    var title: String
    var snippet: String
    var createdMs: Int64?
    var updatedMs: Int64?
    var type: String?
    var transcriptionStatus: String?

    var id: String { path }
    var isRecording: Bool { type == kRecordingNoteType }

    /// Sort key: creation time, then update time, then reverse filename (filenames
    /// are timestamp-prefixed so this approximates newest-first before metadata
    /// is available).
    var sortKey: Int64 { createdMs ?? updatedMs ?? 0 }

    nonisolated static func make(from doc: NoteDocument, path: String) -> NotePreview {
        let fileName = path.split(separator: "/").last.map(String.init) ?? path
        let (title, snippet) = Self.titleAndSnippet(from: doc.body)
        return NotePreview(
            path: path,
            fileName: fileName,
            title: title,
            snippet: snippet,
            createdMs: doc.frontMatter.createdMs,
            updatedMs: doc.frontMatter.updatedMs,
            type: doc.frontMatter.type,
            transcriptionStatus: doc.frontMatter.transcriptionStatus
        )
    }

    nonisolated private static func titleAndSnippet(from body: String) -> (String, String) {
        let lines = body.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var title = ""
        var snippetLines: [String] = []
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if title.isEmpty {
                if !trimmed.isEmpty { title = trimmed }
            } else {
                snippetLines.append(trimmed)
            }
        }
        let snippet =
            snippetLines
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (title.isEmpty ? "Untitled" : title, String(snippet.prefix(160)))
    }
}
