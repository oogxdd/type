import Foundation
import Observation

@MainActor @Observable public final class NotesModel {
    public private(set) var tree: Folder?
    public private(set) var summaries: [String: NoteSummary] = [:]
    public private(set) var draft: Draft?
    public private(set) var isBusy = false
    public private(set) var isSaving = false
    public private(set) var error: String?
    public private(set) var started = false

    private let repository: any NotesRepository
    private let recovery: any DraftRecovery
    private var debounce: Task<Void, Never>?
    private var saving: Task<Bool, Never>?

    public init(repository: any NotesRepository, recovery: any DraftRecovery) {
        self.repository = repository
        self.recovery = recovery
    }

    public func start() async {
        guard !started else { return }
        started = true
        do { draft = try recovery.load() }
        catch { self.error = "Could not restore draft: \(error.localizedDescription)" }
        await refresh()
    }

    public func refresh() async {
        do {
            let next = try await repository.tree()
            tree = next
            // Core caps summaries at 200. Keep full bodies out of list state.
            func paths(_ folder: Folder) -> [String] {
                folder.notes.map(\.path) + folder.children.flatMap(paths)
            }
            let all = paths(next)
            var nextSummaries: [String: NoteSummary] = [:]
            for offset in stride(from: 0, to: all.count, by: 200) {
                let batch = Array(all[offset..<min(offset + 200, all.count)])
                for summary in try await repository.summaries(paths: batch) {
                    nextSummaries[summary.path] = summary
                }
            }
            summaries = nextSummaries
        } catch { self.error = error.localizedDescription }
    }

    public func open(_ note: NoteEntry) async {
        guard draft == nil, !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            guard let body = try await repository.read(path: note.path) else {
                error = "This note no longer exists."
                await refresh()
                return
            }
            draft = Draft(path: note.path, folder: (note.path as NSString).deletingLastPathComponent,
                          body: body, baseline: body)
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    public func newNote(folder: String) {
        guard draft == nil, !isBusy else { return }
        draft = Draft(folder: folder)
        error = nil
    }

    public func edit(_ body: String) {
        guard draft != nil, !isBusy else { return }
        draft?.body = body
        persistRecovery()
        debounce?.cancel()
        debounce = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(400)) }
            catch { return }
            _ = await self?.flush()
        }
    }

    /// A single writer drains edits that arrive while the previous save awaits Rust.
    /// Failed writes keep both the draft and the original comparison baseline.
    @discardableResult public func flush() async -> Bool {
        if let saving { return await saving.value }
        let task = Task { [self] in
            isSaving = true
            defer { isSaving = false }
            while let snapshot = draft, snapshot.isDirty {
                // Empty content is removed only by explicit navigation away.
                if snapshot.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { break }
                do {
                    let path: String
                    if let existing = snapshot.path {
                        try await repository.write(path: existing, body: snapshot.body, baseline: snapshot.baseline)
                        path = existing
                    } else {
                        path = try await repository.create(folder: snapshot.folder, body: snapshot.body)
                    }
                    draft?.path = path
                    draft?.baseline = snapshot.body
                    error = nil
                    persistRecovery()
                } catch {
                    self.error = error.localizedDescription
                    return false
                }
            }
            return true
        }
        saving = task
        let success = await task.value
        saving = nil
        return success
    }

    /// UI dismissal is conditional: a conflict must not strand an invisible draft.
    @discardableResult public func close() async -> Bool {
        guard !isBusy else { return false }
        isBusy = true
        defer { isBusy = false }
        debounce?.cancel()
        guard await flush() else { return false }
        do {
            if let draft, draft.isDirty,
               draft.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
               let path = draft.path {
                try await repository.delete(path: path, baseline: draft.baseline)
            }
            try recovery.store(nil)
            draft = nil
            error = nil
            await refresh()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    private func persistRecovery() {
        do { try recovery.store(draft?.isDirty == true ? draft : nil) }
        catch { self.error = "Could not preserve draft: \(error.localizedDescription)" }
    }

    /// Explicit user decision after exporting or inspecting a conflicting draft.
    /// This never changes the note on disk.
    public func discardDraft() async {
        guard !isBusy, saving == nil else { return }
        debounce?.cancel()
        do {
            try recovery.store(nil)
            draft = nil
            error = nil
            await refresh()
        } catch { self.error = error.localizedDescription }
    }
}
