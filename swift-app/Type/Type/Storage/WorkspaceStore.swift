//
//  WorkspaceStore.swift
//  Type
//
//  Loads/persists the workspaces config and resolves a workspace's notes-root
//  URL. The config lives in Application Support (never inside a notes root) so it
//  does not sync through git — mirroring how the desktop keeps profile config in
//  app data rather than in the synced folder.
//

import Foundation

struct WorkspaceStore {
    private static let configFileName = "workspaces.json"

    /// The app's Documents directory. Notes roots live under here so they are
    /// visible in the Files app (requires `UIFileSharingEnabled` +
    /// `LSSupportsOpeningDocumentsInPlace` in the app's Info settings).
    nonisolated static var documentsDirectory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    nonisolated private static var configURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir.appendingPathComponent(configFileName)
    }

    /// Resolve the on-disk notes root for a workspace.
    nonisolated static func rootURL(for workspace: Workspace) -> URL {
        documentsDirectory.appendingPathComponent(workspace.relativeRoot)
    }

    nonisolated static func load() -> WorkspacesConfig {
        if let data = try? Data(contentsOf: configURL),
            let config = try? JSONDecoder().decode(WorkspacesConfig.self, from: data),
            !config.workspaces.isEmpty
        {
            return config
        }
        let defaultWorkspace = Workspace.defaultWorkspace
        return WorkspacesConfig(
            activeWorkspaceId: defaultWorkspace.id,
            workspaces: [defaultWorkspace]
        )
    }

    nonisolated static func save(_ config: WorkspacesConfig) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(config) else { return }
        try? data.write(to: configURL, options: .atomic)
    }
}
