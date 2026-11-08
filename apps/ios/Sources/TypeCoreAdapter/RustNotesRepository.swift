import Foundation
import TypeDomain
import TypeCoreBindings

/// UniFFI async exports schedule filesystem work on Rust's blocking pool.
/// No Markdown/frontmatter parsing is duplicated in Swift.
public struct RustNotesRepository: NotesRepository {
    public init(appData: URL, documents: URL) throws {
        try FileManager.default.createDirectory(at: appData, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
        try initCore(appDataDir: appData.path, documentsDir: documents.path)
    }

    public func tree() async throws -> Folder {
        try decode(Folder.self, await getTree())
    }

    public func summaries(paths: [String]) async throws -> [NoteSummary] {
        try decode([NoteSummary].self, await listNoteSummaries(paths: paths))
    }

    public func read(path: String) async throws -> String? {
        try await readNoteForEditing(path: path)
    }

    public func create(folder: String, body: String) async throws -> String {
        struct Args: Encodable { let folder_path: String; let content: String }
        struct Created: Decodable { let path: String }
        let args = try JSONEncoder().encode(Args(folder_path: folder, content: body))
        return try decode(Created.self, await createNote(argsJson: String(decoding: args, as: UTF8.self))).path
    }

    public func write(path: String, body: String, baseline: String) async throws {
        try await writeNoteChecked(path: path, content: body, baseline: baseline)
    }

    public func delete(path: String, baseline: String) async throws {
        try await deleteNoteChecked(path: path, baseline: baseline)
    }

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }
}
