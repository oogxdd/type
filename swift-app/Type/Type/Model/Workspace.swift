//
//  Workspace.swift
//  Type
//
//  A "workspace" is the working directory the app reads/writes/syncs — the same
//  concept the desktop calls a *profile*. Today the app ships a single default
//  workspace, but the model is intentionally a list with per-workspace settings
//  so multi-profile support (item 7 in the brief) can be added later without a
//  data migration: each workspace already owns its own notes root and its own
//  git remote / settings.
//

import Foundation

/// Per-workspace settings. Anything that can legitimately differ between two
/// working directories lives here (git remote, filename strategy, …).
struct WorkspaceSettings: Codable, Equatable {
    var noteFileNameFormat: NoteFileNameFormat = .utcTimestampSlug

    // Git sync (Stage 2). The secret (token / password) is NOT stored here — it
    // lives in the Keychain keyed by the workspace id.
    var gitRemoteURL: String = ""
    /// Empty means "use whatever branch HEAD points at, else main".
    var gitBranch: String = ""
    var gitUsername: String = ""
    var gitAuthorName: String = ""
    var gitAuthorEmail: String = ""

    // Transcription (Stage 4). Off by default — phone is record-first; review and
    // organize on the desktop after sync, or enable on-device transcription here.
    var transcriptionEnabled: Bool = false
}

struct Workspace: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    /// Notes-root path relative to the app's Documents directory (e.g. "Notes").
    /// Keeping it relative keeps the data portable and visible in the Files app.
    var relativeRoot: String
    var settings: WorkspaceSettings

    init(
        id: String = UUIDv7.generate(),
        name: String,
        relativeRoot: String,
        settings: WorkspaceSettings = WorkspaceSettings()
    ) {
        self.id = id
        self.name = name
        self.relativeRoot = relativeRoot
        self.settings = settings
    }

    static let defaultWorkspace = Workspace(name: "Notes", relativeRoot: "Notes")
}

/// On-disk shape of the workspaces config (stored in Application Support, NOT in
/// any notes root, so it never syncs through git). Maps cleanly onto the desktop
/// `.notes-profiles.json` if the two are ever unified.
struct WorkspacesConfig: Codable, Equatable {
    var activeWorkspaceId: String
    var workspaces: [Workspace]
}
