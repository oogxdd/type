//
//  AppState.swift
//  Type
//
//  The central, observable app coordinator. Owns the active workspace + its
//  notes store, the folder tree, and the in-memory compose draft. UI reads it via
//  `@Environment(AppState.self)`.
//

import Foundation
import Observation

@MainActor
@Observable
final class AppState {
    private(set) var config: WorkspacesConfig
    private(set) var tree: FolderTree
    /// The blank-page composer text. Held here so it survives tab switches.
    var draftText: String = ""
    var loadError: String?

    /// Set by a `type://record` deep link; Stage 3 consumes this to auto-start a
    /// recording. Kept here so the signal isn't lost across view lifecycles.
    var pendingRecordIntent = false

    /// Git sync orchestrator (Stage 2). Observable; the UI reads `app.git.phase`.
    let git = GitSyncCoordinator()

    init() {
        config = WorkspaceStore.load()
        tree = FolderTree(name: "Notes", path: "", folders: [], notes: [])
        bootstrap()
        configureRecorder()
        configureTranscription()
    }

    // MARK: Workspace / store

    var activeWorkspace: Workspace {
        config.workspaces.first { $0.id == config.activeWorkspaceId } ?? config.workspaces[0]
    }

    var store: NotesStore { NotesStore(root: WorkspaceStore.rootURL(for: activeWorkspace)) }

    func bootstrap() {
        do {
            try store.ensureSystemFolders()
            tree = try store.buildTree()
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    func refreshTree() {
        do {
            tree = try store.buildTree()
        } catch {
            loadError = error.localizedDescription
        }
    }

    // MARK: Tree queries

    func folderNode(at path: String) -> FolderTree? {
        if path.isEmpty { return tree }
        func search(_ node: FolderTree) -> FolderTree? {
            if node.path == path { return node }
            for child in node.folders {
                if let found = search(child) { return found }
            }
            return nil
        }
        return search(tree)
    }

    func previews(forFolderPath path: String) -> [NotePreview] {
        guard let node = folderNode(at: path) else { return [] }
        return store.previews(inFolderRelative: path, treeNotes: node.notes)
    }

    var feedPreviews: [NotePreview] { previews(forFolderPath: NotesLayout.feedFolder) }

    /// Top-level folders shown in Browse (hidden storage folders are already
    /// excluded by `buildTree`; Feed has its own section in the UI).
    var browsableTopFolders: [FolderTree] {
        tree.folders.filter { $0.name != NotesLayout.feedFolder }
    }

    // MARK: Compose

    /// Persist the current draft as a Feed note and clear the composer.
    @discardableResult
    func commitDraft() -> String? {
        guard !draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            draftText = ""
            return nil
        }
        do {
            let path = try store.createNote(
                folderRelative: NotesLayout.feedFolder,
                content: draftText,
                format: activeWorkspace.settings.noteFileNameFormat
            )
            draftText = ""
            refreshTree()
            return path
        } catch {
            loadError = error.localizedDescription
            return nil
        }
    }

    // MARK: Note mutations

    @discardableResult
    func createNote(inFolder folder: String) -> String? {
        do {
            let path = try store.createNote(
                folderRelative: folder,
                content: "",
                format: activeWorkspace.settings.noteFileNameFormat
            )
            refreshTree()
            return path
        } catch {
            loadError = error.localizedDescription
            return nil
        }
    }

    func saveBody(_ body: String, path: String) {
        do {
            try store.writeBody(body, relativePath: path)
        } catch {
            loadError = error.localizedDescription
        }
    }

    func readDocument(path: String) -> NoteDocument? {
        try? store.readDocument(relativePath: path)
    }

    func deleteNote(path: String) {
        do {
            try store.delete(relativePaths: [path])
            refreshTree()
        } catch {
            loadError = error.localizedDescription
        }
    }

    // MARK: Folder mutations

    func createFolder(parent: String, name: String) {
        do {
            try store.createFolder(parentRelative: parent, name: name)
            refreshTree()
        } catch {
            loadError = error.localizedDescription
        }
    }

    func deleteFolder(path: String) {
        do {
            try store.delete(relativePaths: [path])
            refreshTree()
        } catch {
            loadError = error.localizedDescription
        }
    }

    // MARK: Settings

    func updateActiveSettings(_ mutate: (inout WorkspaceSettings) -> Void) {
        guard let index = config.workspaces.firstIndex(where: { $0.id == activeWorkspace.id })
        else { return }
        mutate(&config.workspaces[index].settings)
        WorkspaceStore.save(config)
        configureRecorder()
        configureTranscription()
    }

    func renameActiveWorkspace(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
            let index = config.workspaces.firstIndex(where: { $0.id == activeWorkspace.id })
        else { return }
        config.workspaces[index].name = trimmed
        WorkspaceStore.save(config)
        configureRecorder()
        configureTranscription()
    }

    // MARK: Git sync

    func gitToken() -> String {
        GitCredentialStore.secret(workspaceId: activeWorkspace.id) ?? ""
    }

    func setGitToken(_ token: String) {
        GitCredentialStore.saveSecret(token, workspaceId: activeWorkspace.id)
    }

    func syncNow() async {
        let workspace = activeWorkspace
        let root = WorkspaceStore.rootURL(for: workspace)
        // Make sure the system folders exist before the first commit.
        try? store.ensureSystemFolders()

        let settings = workspace.settings
        let credentials = GitCredentials(
            username: settings.gitUsername,
            secret: GitCredentialStore.secret(workspaceId: workspace.id) ?? ""
        )
        let signature = GitSignature(
            name: settings.gitAuthorName.isEmpty
                ? GitSignature.fallback.name : settings.gitAuthorName,
            email: settings.gitAuthorEmail.isEmpty
                ? GitSignature.fallback.email : settings.gitAuthorEmail
        )

        await git.sync(
            root: root,
            remoteURL: settings.gitRemoteURL,
            branch: settings.gitBranch,
            signature: signature,
            credentials: credentials
        )
        refreshTree()
    }

    // MARK: Recording (Stage 3)

    /// Point the shared recorder at the active workspace and wire its completion
    /// back into the tree. Recording runs in the app process (see `AudioRecorder`);
    /// this also installs the cross-process command observer on first call.
    func configureRecorder() {
        let workspace = activeWorkspace
        AudioRecorder.shared.configure(
            root: WorkspaceStore.rootURL(for: workspace),
            format: workspace.settings.noteFileNameFormat,
            folder: NotesLayout.feedFolder,
            workspaceName: workspace.name
        )
        AudioRecorder.shared.onSaved = { [weak self] path in
            guard let self else { return }
            self.refreshTree()
            // Hand the fresh recording to on-device transcription (a no-op when
            // the workspace has transcription disabled).
            TranscriptionManager.shared.enqueue(notePath: path)
        }
    }

    // MARK: Transcription (Stage 4)

    /// Point the on-device transcriber at the active workspace and wire its
    /// completion back into the tree (so a finished transcript shows up without a
    /// manual reload). Off unless the workspace opts in.
    func configureTranscription() {
        let workspace = activeWorkspace
        TranscriptionManager.shared.configure(
            root: WorkspaceStore.rootURL(for: workspace),
            enabled: workspace.settings.transcriptionEnabled
        )
        TranscriptionManager.shared.onUpdated = { [weak self] in
            self?.refreshTree()
        }
    }

    /// Scan the workspace for recordings still needing transcription and run them
    /// (Settings action; also useful after a sync pulls in remote recordings).
    func transcribePendingRecordings() {
        TranscriptionManager.shared.enqueuePending()
    }

    // MARK: Deep links

    func handleDeepLink(_ url: URL) {
        // `type://record` (home-screen widget) → switch to Record + auto-start.
        if url.host == "record" || url.path.contains("record") {
            pendingRecordIntent = true
        }
    }
}
