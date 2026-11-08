import Foundation
import Testing
@testable import TypeDomain

private actor Repository: NotesRepository {
    var bodies: [String: String] = [:]
    var writes = 0
    var creates = 0
    var pause = false
    var continuation: CheckedContinuation<Void, Never>?
    func tree() throws -> Folder {
        try JSONDecoder().decode(Folder.self, from: Data(#"{"name":"Notes","path":"","children":[],"notes":[]}"#.utf8))
    }
    func summaries(paths: [String]) -> [NoteSummary] { [] }
    func read(path: String) -> String? { bodies[path] }
    func create(folder: String, body: String) async -> String {
        creates += 1
        if pause { await withCheckedContinuation { continuation = $0 } }
        let path = "\(folder)/new.md"
        bodies[path] = body
        return path
    }
    func write(path: String, body: String, baseline: String) throws {
        guard bodies[path] == baseline else { throw Conflict() }
        writes += 1
        bodies[path] = body
    }
    func delete(path: String, baseline: String) throws {
        guard bodies[path] == baseline else { throw Conflict() }
        bodies.removeValue(forKey: path)
    }
    func seed(_ body: String) { bodies["note.md"] = body }
    func holdCreate() { pause = true }
    func resume() { pause = false; continuation?.resume(); continuation = nil }
    var isWaiting: Bool { continuation != nil }
    struct Conflict: Error {}
}

@MainActor private final class Recovery: DraftRecovery {
    var draft: Draft?
    func load() -> Draft? { draft }
    func store(_ draft: Draft?) { self.draft = draft }
}

@MainActor @Test func createDrainsEditsDuringSaveWithoutDuplicatingNote() async throws {
    let repo = Repository()
    let recovery = Recovery()
    let model = NotesModel(repository: repo, recovery: recovery)
    await repo.holdCreate()
    model.newNote(folder: "_system/stream")
    model.edit("First")
    let save = Task { await model.flush() }
    while !(await repo.isWaiting) { await Task.yield() }
    model.edit("First + 日本語 👋")
    await repo.resume()
    #expect(await save.value)
    #expect(await repo.creates == 1)
    #expect(await repo.read(path: "_system/stream/new.md") == "First + 日本語 👋")
    #expect(model.draft?.isDirty == false)
    #expect(recovery.draft == nil)
    #expect(await model.close())
}

@MainActor @Test func conflictRetainsDraftAndPreventsDismissal() async throws {
    let repo = Repository()
    await repo.seed("Original")
    let recovery = Recovery()
    let model = NotesModel(repository: repo, recovery: recovery)
    await model.open(NoteEntry(name: "note", path: "note.md"))
    model.edit("My draft")
    await repo.seed("External edit")
    #expect(await model.close() == false)
    #expect(model.draft?.body == "My draft")
    #expect(model.draft?.baseline == "Original")
    #expect(recovery.draft?.body == "My draft")
    #expect(await repo.read(path: "note.md") == "External edit")
}

@MainActor @Test func emptyDirtyNoteDeletesOnlyOnLeavingAndChecksBaseline() async throws {
    let repo = Repository()
    await repo.seed("Original")
    let model = NotesModel(repository: repo, recovery: Recovery())
    await model.open(NoteEntry(name: "note", path: "note.md"))
    model.edit("")
    #expect(await model.flush())
    #expect(await repo.read(path: "note.md") == "Original")
    await repo.seed("External")
    #expect(await model.close() == false)
    #expect(model.draft != nil)
    await repo.seed("Original")
    #expect(await model.close())
    #expect(await repo.read(path: "note.md") == nil)
}

@MainActor @Test func emptyCaptureCreatesNothingAndMissingReadDoesNotOpen() async throws {
    let repo = Repository()
    let model = NotesModel(repository: repo, recovery: Recovery())
    model.newNote(folder: "_system/stream")
    model.edit("  \n")
    #expect(await model.close())
    #expect(await repo.creates == 0)
    await model.open(NoteEntry(name: "missing", path: "missing.md"))
    #expect(model.draft == nil)
    #expect(model.error != nil)
}

@MainActor @Test func recoveredDraftKeepsOriginalBaseline() async throws {
    let repo = Repository()
    let recovery = Recovery()
    recovery.draft = Draft(path: "note.md", folder: "", body: "Recovered", baseline: "Old")
    await repo.seed("New external")
    let model = NotesModel(repository: repo, recovery: recovery)
    await model.start()
    #expect(model.draft?.body == "Recovered")
    #expect(await model.flush() == false)
    #expect(await repo.read(path: "note.md") == "New external")
}

@MainActor @Test func discardConflictPreservesDiskAndClearsRecovery() async throws {
    let repo = Repository()
    await repo.seed("Original")
    let recovery = Recovery()
    let model = NotesModel(repository: repo, recovery: recovery)
    await model.open(NoteEntry(name: "note", path: "note.md"))
    model.edit("Discard me")
    await repo.seed("External")
    #expect(await model.flush() == false)
    await model.discardDraft()
    #expect(model.draft == nil)
    #expect(recovery.draft == nil)
    #expect(await repo.read(path: "note.md") == "External")
}
