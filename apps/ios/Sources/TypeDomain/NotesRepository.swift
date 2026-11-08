import Foundation

public struct NoteEntry: Codable, Sendable, Identifiable, Equatable {
    public let name: String
    public let path: String
    public var id: String { path }
}

public struct Folder: Codable, Sendable, Identifiable, Equatable {
    public let name: String
    public let path: String
    public let children: [Folder]
    public let notes: [NoteEntry]
    public var id: String { path }

    public func find(_ path: String) -> Folder? {
        if self.path == path { return self }
        return children.lazy.compactMap { $0.find(path) }.first
    }
}

public struct NoteSummary: Decodable, Sendable {
    public let path: String
    public let title: String
    public let second_line: String
}

/// Only the operations this shell owns. JSON and UniFFI stay in the adapter.
public protocol NotesRepository: Sendable {
    func tree() async throws -> Folder
    func summaries(paths: [String]) async throws -> [NoteSummary]
    func read(path: String) async throws -> String?
    func create(folder: String, body: String) async throws -> String
    func write(path: String, body: String, baseline: String) async throws
    func delete(path: String, baseline: String) async throws
}

public struct Draft: Codable, Sendable, Equatable {
    public var path: String?
    public var folder: String
    public var body: String
    public var baseline: String

    public init(path: String? = nil, folder: String, body: String = "", baseline: String = "") {
        self.path = path
        self.folder = folder
        self.body = body
        self.baseline = baseline
    }

    public var isDirty: Bool { body != baseline }
}

/// Device-local recovery, never a second source of truth for saved notes.
@MainActor public protocol DraftRecovery {
    func load() throws -> Draft?
    func store(_ draft: Draft?) throws
}
