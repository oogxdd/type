//
//  GitSyncCoordinator.swift
//  Type
//
//  Drives a full sync: commit local → fetch → integrate (ff/merge) → push, all
//  off the main actor. Exposes observable status for the UI. This mirrors the
//  desktop's one-button sync flow.
//

import Foundation
import Observation

@MainActor
@Observable
final class GitSyncCoordinator {
    enum Phase: Equatable {
        case idle
        case syncing
        case success
        case error
    }

    private(set) var phase: Phase = .idle
    private(set) var message = ""
    private(set) var lastSyncedMs: Int64?

    private let client: GitClient = GitClientFactory.make()

    var isAvailable: Bool { GitClientFactory.isAvailable }
    var isSyncing: Bool { phase == .syncing }

    /// Run the full sync. `branch` empty means "use HEAD, else main".
    func sync(
        root: URL,
        remoteURL: String,
        branch: String,
        signature: GitSignature,
        credentials: GitCredentials
    ) async {
        guard !remoteURL.trimmingCharacters(in: .whitespaces).isEmpty else {
            phase = .error
            message = GitSyncError.notConfigured.localizedDescription
            return
        }

        phase = .syncing
        message = "Syncing…"

        let client = self.client
        do {
            try await run { try client.ensureRepository(at: root, remoteURL: remoteURL) }

            let resolvedBranch = await resolveBranch(branch, root: root)
            try await run { try client.prepareBranch(at: root, branch: resolvedBranch) }

            let committed = try await run {
                try client.commitAll(
                    at: root, message: "Update notes (iOS)", author: signature)
            }

            let outcome = try await run {
                try client.pull(at: root, branch: resolvedBranch, credentials: credentials)
            }

            try await run {
                try client.push(at: root, branch: resolvedBranch, credentials: credentials)
            }

            lastSyncedMs = Int64(Date().timeIntervalSince1970 * 1000)
            phase = .success
            message = summary(committed: committed, outcome: outcome)
        } catch {
            phase = .error
            message = (error as? GitSyncError)?.localizedDescription ?? error.localizedDescription
        }
    }

    // MARK: Helpers

    /// Hop the blocking libgit2 call off the main actor.
    private func run<T: Sendable>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
        try await Task.detached(priority: .userInitiated, operation: work).value
    }

    private func resolveBranch(_ configured: String, root: URL) async -> String {
        let trimmed = configured.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { return trimmed }
        let client = self.client
        if let head = await Task.detached(priority: .userInitiated, operation: {
            client.currentBranch(at: root)
        }).value {
            return head
        }
        return "main"
    }

    private func summary(committed: Bool, outcome: GitPullOutcome) -> String {
        var parts: [String] = []
        parts.append(committed ? "Pushed local changes" : "No local changes")
        switch outcome {
        case .upToDate: parts.append("up to date")
        case .fastForwarded: parts.append("pulled updates")
        case .merged: parts.append("merged updates")
        case .mergedWithConflicts(let paths):
            parts.append("merged with \(paths.count) conflict(s) saved as .conflict.md")
        }
        return parts.joined(separator: " · ")
    }
}
