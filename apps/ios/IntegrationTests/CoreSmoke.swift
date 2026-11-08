import Foundation
import TypeDomain
import TypeCoreAdapter

/// Runs against the real Rust adapter in a fresh fixture, never a personal profile.
@main struct CoreSmoke {
    static func main() async throws {
        let files = FileManager.default
        let fixture = files.temporaryDirectory.appendingPathComponent("type-swift-smoke-\(UUID())")
        let root = fixture.appendingPathComponent("notes")
        try files.createDirectory(at: root, withIntermediateDirectories: true)
        setenv("NOTES_ROOT", root.path, 1)
        defer { try? files.removeItem(at: fixture) }
        let repository = try RustNotesRepository(appData: fixture.appendingPathComponent("app"),
                                                 documents: fixture.appendingPathComponent("Documents"))
        let path = try await repository.create(folder: "_system/stream", body: "Привет 👋\n日本語")
        let body = try await repository.read(path: path)
        precondition(body == "Привет 👋\n日本語")
        let file = root.appendingPathComponent(path)
        let original = try String(contentsOf: file, encoding: .utf8)
        let withUnknown = original.replacingOccurrences(of: "---\n", with: "---\ncustom_field: keep-me\n",
                                                        range: original.range(of: "---\n"))
        try withUnknown.write(to: file, atomically: true, encoding: .utf8)
        try await repository.write(path: path, body: "Changed", baseline: body!)
        let saved = try String(contentsOf: file, encoding: .utf8)
        precondition(saved.contains("custom_field: keep-me"))
        do {
            try await repository.write(path: path, body: "Overwrite", baseline: body!)
            fatalError("Stale baseline must fail")
        } catch { /* expected conflict */ }
        let afterConflict = try await repository.read(path: path)
        precondition(afterConflict == "Changed")
        let tree = try await repository.tree()
        precondition(tree.find("_system/stream")?.notes.contains { $0.path == path } == true)
        let summaries = try await repository.summaries(paths: [path])
        precondition(summaries.first?.title == "Changed")
        try await repository.delete(path: path, baseline: "Changed")
        let missing = try await repository.read(path: path)
        precondition(missing == nil)
        print("Swift → UniFFI → Rust passed: Unicode, tree, summaries, frontmatter, checked writes/deletes, missing reads")
    }
}
