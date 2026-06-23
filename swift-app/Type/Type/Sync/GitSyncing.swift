//
//  GitSyncing.swift
//  Type
//
//  Git sync abstraction. The whole feature is written against `GitClient` so the
//  app builds with or without a libgit2 package present. The concrete libgit2
//  implementation lives in `LibGit2Client.swift`, gated behind
//  `#if canImport(Clibgit2)`; when the package is absent, `UnavailableGitClient`
//  is used and every operation reports a friendly "not set up" error.
//
//  Compatibility: git is git. As long as this client commits the same files to
//  the same branch of the same remote, the desktop Tauri app (which uses libgit2
//  too) syncs cleanly. We mirror the desktop's conventions: remote name `origin`,
//  branch = configured value else HEAD else `main`, and the "keep ours, write
//  theirs as <name>.conflict.md" merge policy so a pull is never blocked.
//

import Foundation

struct GitSignature: Sendable, Equatable {
    var name: String
    var email: String

    static let fallback = GitSignature(name: "Type (iOS)", email: "ios@local")
}

/// HTTPS username + secret (a Personal Access Token or password). For SSH the
/// secret is unused (key auth is best-effort and described in SYNC.md).
struct GitCredentials: Sendable, Equatable {
    var username: String
    var secret: String

    var isEmpty: Bool { username.isEmpty && secret.isEmpty }
}

enum GitPullOutcome: Sendable, Equatable {
    case upToDate
    case fastForwarded
    case merged
    case mergedWithConflicts([String])  // paths that produced `.conflict.md` siblings
}

enum GitSyncError: LocalizedError, Sendable {
    case notConfigured
    case unavailable
    case missingCredentials
    case auth(String)
    case diverged
    case git(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Add a remote URL in Sync settings first."
        case .unavailable:
            return "Git support isn't compiled in. Add the libgit2 Swift package (see SYNC.md)."
        case .missingCredentials:
            return "Add your username and token in Sync settings."
        case .auth(let message):
            return "Authentication failed: \(message)"
        case .diverged:
            return "Local and remote have diverged with conflicts. Resolve on desktop, then pull."
        case .git(let message):
            return message
        }
    }
}

/// Synchronous, blocking git operations. `Sendable` so the coordinator can run
/// them off the main actor via `Task.detached`.
protocol GitClient: Sendable {
    /// Open the repo at `root` (initializing it if needed) and make `origin`
    /// point at `remoteURL`.
    func ensureRepository(at root: URL, remoteURL: String) throws

    /// Point HEAD at `branch` when the repo is freshly initialized (so the first
    /// commit lands there), or check out an existing local `branch`.
    func prepareBranch(at root: URL, branch: String) throws

    /// The checked-out branch name, if any.
    func currentBranch(at root: URL) -> String?

    /// Stage every change and commit. Returns false if there was nothing to commit.
    @discardableResult
    func commitAll(at root: URL, message: String, author: GitSignature) throws -> Bool

    /// Fetch `origin` and integrate `branch` (fast-forward, else merge keeping
    /// ours and writing theirs as `<name>.conflict.md`).
    func pull(at root: URL, branch: String, credentials: GitCredentials) throws -> GitPullOutcome

    /// Push `branch` to `origin`.
    func push(at root: URL, branch: String, credentials: GitCredentials) throws
}

/// Used when no libgit2 package is linked. Keeps the app fully functional
/// (offline, local-only) and tells the user how to enable sync.
struct UnavailableGitClient: GitClient {
    func ensureRepository(at root: URL, remoteURL: String) throws { throw GitSyncError.unavailable }
    func prepareBranch(at root: URL, branch: String) throws { throw GitSyncError.unavailable }
    func currentBranch(at root: URL) -> String? { nil }
    func commitAll(at root: URL, message: String, author: GitSignature) throws -> Bool {
        throw GitSyncError.unavailable
    }
    func pull(at root: URL, branch: String, credentials: GitCredentials) throws -> GitPullOutcome {
        throw GitSyncError.unavailable
    }
    func push(at root: URL, branch: String, credentials: GitCredentials) throws {
        throw GitSyncError.unavailable
    }
}

enum GitClientFactory {
    static func make() -> GitClient {
        #if canImport(Clibgit2)
        return LibGit2Client()
        #else
        return UnavailableGitClient()
        #endif
    }

    /// Whether a real git backend is compiled in (drives UI hints).
    static var isAvailable: Bool {
        #if canImport(Clibgit2)
        return true
        #else
        return false
        #endif
    }
}
