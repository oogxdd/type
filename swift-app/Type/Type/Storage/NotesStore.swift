//
//  NotesStore.swift
//  Type
//
//  Filesystem engine for a single notes root. Layout-compatible with the Rust
//  backend so the same git repository round-trips between desktop and iOS.
//
//  All methods are `nonisolated` and synchronous so callers can run them off the
//  main actor (`await Task.detached { … }`) for large trees. Notes are small, so
//  Stage 1 calls them directly.
//
//  NOTE: At-rest encryption is intentionally NOT implemented here (it is a later
//  design item). Bodies are written as plaintext, which is compatible with a
//  desktop that also has encryption disabled (the default).
//

import Foundation

enum NotesStoreError: LocalizedError {
    case protectedFolder(String)
    case invalidName(String)
    case notFound(String)

    var errorDescription: String? {
        switch self {
        case .protectedFolder(let name): return "“\(name)” is a system folder and can't be changed."
        case .invalidName(let name): return "“\(name)” isn't a valid name."
        case .notFound(let path): return "Couldn't find “\(path)”."
        }
    }
}

struct NotesStore {
    let root: URL

    init(root: URL) { self.root = root }

    // MARK: Path helpers

    nonisolated func url(forRelative rel: String) -> URL {
        let trimmed = rel.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !trimmed.isEmpty else { return root }
        var url = root
        for component in trimmed.split(separator: "/") {
            url.appendPathComponent(String(component))
        }
        return url
    }

    nonisolated func relative(of url: URL) -> String {
        let rootComponents = root.standardizedFileURL.pathComponents
        let urlComponents = url.standardizedFileURL.pathComponents
        guard urlComponents.count >= rootComponents.count,
            Array(urlComponents.prefix(rootComponents.count)) == rootComponents
        else {
            return url.path
        }
        return urlComponents.dropFirst(rootComponents.count).joined(separator: "/")
    }

    // MARK: System folders + legacy migration

    nonisolated func ensureSystemFolders() throws {
        if !FileManager.default.fileExists(atPath: root.path) {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        }
        try migrateLegacyFolders()

        for name in NotesLayout.requiredSystemFolders {
            let url = root.appendingPathComponent(name)
            if !FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            }
        }

        var order = readOrder(at: root)
        var changed = false
        for name in NotesLayout.visibleSystemFolders where !order.folderOrder.contains(name) {
            order.folderOrder.append(name)
            changed = true
        }
        if changed { try writeOrder(order, at: root) }

        // Feed never keeps an order file.
        let feedOrder = root
            .appendingPathComponent(NotesLayout.feedFolder)
            .appendingPathComponent(NotesLayout.orderFileName)
        if FileManager.default.fileExists(atPath: feedOrder.path) {
            try? FileManager.default.removeItem(at: feedOrder)
        }
    }

    nonisolated private func migrateLegacyFolders() throws {
        try mergeFolder(from: NotesLayout.legacyUnsortedFolder, into: NotesLayout.feedFolder)
        try mergeFolder(from: NotesLayout.legacyRecordingsFolder, into: NotesLayout.recordingsFolder)
    }

    nonisolated private func mergeFolder(from fromName: String, into toName: String) throws {
        let from = root.appendingPathComponent(fromName)
        guard FileManager.default.fileExists(atPath: from.path) else { return }
        let to = root.appendingPathComponent(toName)
        if !FileManager.default.fileExists(atPath: to.path) {
            try FileManager.default.moveItem(at: from, to: to)
            return
        }
        let entries = (try? FileManager.default.contentsOfDirectory(at: from, includingPropertiesForKeys: nil)) ?? []
        for entry in entries {
            let target = to.appendingPathComponent(entry.lastPathComponent)
            if FileManager.default.fileExists(atPath: target.path) { continue }
            try FileManager.default.moveItem(at: entry, to: target)
        }
        try? FileManager.default.removeItem(at: from)
    }

    // MARK: Tree

    nonisolated func buildTree() throws -> FolderTree {
        try buildNode(at: root, relative: "")
    }

    nonisolated private func buildNode(at dir: URL, relative rel: String) throws -> FolderTree {
        let order = readOrder(at: dir)
        var folderNames: [String] = []
        var noteNames: [String] = []

        let entries = try FileManager.default.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: []
        )
        for entry in entries {
            let name = entry.lastPathComponent
            if name == NotesLayout.orderFileName { continue }
            if rel.isEmpty && NotesLayout.hiddenRootFolders.contains(name) { continue }
            let isDir = (try? entry.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
            if isDir {
                if name.hasPrefix(".") { continue }
                folderNames.append(name)
            } else if entry.pathExtension == "md" {
                noteNames.append(name)
            }
        }

        let sortedFolders = OrderFile.sort(folderNames, by: order.folderOrder)
        let sortedNotes: [String]
        if rel == NotesLayout.feedFolder {
            // Feed: newest-first by filename (timestamp-prefixed). The UI re-sorts
            // by real front-matter timestamps once previews load.
            sortedNotes = noteNames.sorted { $0.lowercased() > $1.lowercased() }
        } else {
            sortedNotes = OrderFile.sort(noteNames, by: order.noteOrder)
        }

        var children: [FolderTree] = []
        for name in sortedFolders {
            let childRel = rel.isEmpty ? name : "\(rel)/\(name)"
            children.append(try buildNode(at: dir.appendingPathComponent(name), relative: childRel))
        }

        let notes = sortedNotes.map { name -> NoteRef in
            let noteRel = rel.isEmpty ? name : "\(rel)/\(name)"
            return NoteRef(name: name, path: noteRel)
        }

        return FolderTree(
            name: rel.isEmpty ? "Notes" : dir.lastPathComponent,
            path: rel,
            folders: children,
            notes: notes
        )
    }

    // MARK: Read / write

    nonisolated func readDocument(relativePath: String) throws -> NoteDocument {
        let url = url(forRelative: relativePath)
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw NotesStoreError.notFound(relativePath)
        }
        let raw = try String(contentsOf: url, encoding: .utf8)
        return NoteDocument.parse(raw)
    }

    nonisolated func writeDocument(_ doc: NoteDocument, relativePath: String) throws {
        let url = url(forRelative: relativePath)
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(doc.render().utf8).write(to: url, options: .atomic)
    }

    /// Update an existing note's body, refreshing `updated_ms`. Preserves all
    /// other front-matter (and passthrough lines).
    nonisolated func writeBody(_ body: String, relativePath: String, now: Int64? = nil) throws {
        var doc =
            (try? readDocument(relativePath: relativePath))
            ?? NoteDocument(frontMatter: NoteFrontMatter(), body: "")
        if doc.frontMatter.id == nil { doc.frontMatter.id = UUIDv7.generate() }
        let nowMs = now ?? Int64(Date().timeIntervalSince1970 * 1000)
        if doc.frontMatter.createdMs == nil { doc.frontMatter.createdMs = nowMs }
        doc.frontMatter.updatedMs = nowMs
        doc.body = body
        try writeDocument(doc, relativePath: relativePath)
    }

    // MARK: Create

    /// Create a note in `folderRelative` (default Feed). Returns its relative path.
    @discardableResult
    nonisolated func createNote(
        folderRelative: String,
        content: String,
        timestampMs: Int64? = nil,
        format: NoteFileNameFormat
    ) throws -> String {
        let folderRel = folderRelative.isEmpty ? NotesLayout.feedFolder : folderRelative
        let folderURL = url(forRelative: folderRel)
        try FileManager.default.createDirectory(at: folderURL, withIntermediateDirectories: true)

        let now = timestampMs ?? Int64(Date().timeIntervalSince1970 * 1000)
        let noteId = UUIDv7.generate(now: now)
        let fallback = "note"
        let fileName = NoteNaming.allocateFileName(
            format: format,
            timestampMs: now,
            noteId: noteId,
            content: content,
            fallbackSlug: fallback
        ) { candidate in
            FileManager.default.fileExists(atPath: folderURL.appendingPathComponent(candidate).path)
        }

        var fm = NoteFrontMatter()
        fm.id = noteId
        fm.createdMs = now
        fm.updatedMs = now
        let doc = NoteDocument(frontMatter: fm, body: content)

        let rel = "\(folderRel)/\(fileName)"
        try writeDocument(doc, relativePath: rel)
        if folderRel != NotesLayout.feedFolder {
            try appendOrder(names: [fileName], isFolder: false, at: folderURL)
        }
        return rel
    }

    /// Create a subfolder. Returns its relative path.
    @discardableResult
    nonisolated func createFolder(parentRelative: String, name: String) throws -> String {
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanName.isEmpty, !cleanName.contains("/"), !cleanName.hasPrefix(".") else {
            throw NotesStoreError.invalidName(name)
        }
        let parentURL = url(forRelative: parentRelative)
        let folderURL = parentURL.appendingPathComponent(cleanName)
        try FileManager.default.createDirectory(at: folderURL, withIntermediateDirectories: true)
        if parentRelative != NotesLayout.feedFolder {
            try appendOrder(names: [cleanName], isFolder: true, at: parentURL)
        }
        return parentRelative.isEmpty ? cleanName : "\(parentRelative)/\(cleanName)"
    }

    // MARK: Delete

    nonisolated func delete(relativePaths: [String]) throws {
        for rel in relativePaths {
            let url = url(forRelative: rel)
            let name = url.lastPathComponent
            if NotesLayout.protectedFolders.contains(rel) {
                throw NotesStoreError.protectedFolder(name)
            }
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            try FileManager.default.removeItem(at: url)
            let parent = url.deletingLastPathComponent()
            if parent != root.appendingPathComponent(NotesLayout.feedFolder) {
                try? removeOrder(names: [name], at: parent)
            }
        }
    }

    // MARK: Previews

    /// Build previews for every note directly inside `folderRelative`, sorted the
    /// way the UI wants: Feed is newest-first by date, other folders follow the
    /// order file (already applied by `buildTree`).
    nonisolated func previews(inFolderRelative folderRel: String, treeNotes: [NoteRef]) -> [NotePreview] {
        var previews: [NotePreview] = []
        previews.reserveCapacity(treeNotes.count)
        for ref in treeNotes {
            guard let doc = try? readDocument(relativePath: ref.path) else { continue }
            previews.append(NotePreview.make(from: doc, path: ref.path))
        }
        if folderRel == NotesLayout.feedFolder {
            previews.sort { $0.sortKey > $1.sortKey }
        }
        return previews
    }

    // MARK: Order files

    nonisolated func readOrder(at dir: URL) -> OrderFile {
        let url = dir.appendingPathComponent(NotesLayout.orderFileName)
        guard let data = try? Data(contentsOf: url),
            let order = try? JSONDecoder().decode(OrderFile.self, from: data)
        else { return OrderFile() }
        return order
    }

    nonisolated func writeOrder(_ order: OrderFile, at dir: URL) throws {
        // Feed sorts by date and never persists an order file (matches Rust).
        if dir.lastPathComponent == NotesLayout.feedFolder { return }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted]
        let data = try encoder.encode(order)
        try data.write(to: dir.appendingPathComponent(NotesLayout.orderFileName), options: .atomic)
    }

    nonisolated func appendOrder(names: [String], isFolder: Bool, at dir: URL) throws {
        var order = readOrder(at: dir)
        for name in names {
            if isFolder {
                if !order.folderOrder.contains(name) { order.folderOrder.append(name) }
            } else {
                if !order.noteOrder.contains(name) { order.noteOrder.append(name) }
            }
        }
        try writeOrder(order, at: dir)
    }

    nonisolated func removeOrder(names: [String], at dir: URL) throws {
        var order = readOrder(at: dir)
        order.folderOrder.removeAll { names.contains($0) }
        order.noteOrder.removeAll { names.contains($0) }
        try writeOrder(order, at: dir)
    }
}
