//
//  LibGit2Client.swift
//  Type
//
//  The real git backend, implemented against the libgit2 **C API** (the most
//  stable target for blind porting). The whole file is gated behind
//  `#if canImport(Clibgit2)`, so the app builds and runs fully without a git
//  package linked; `UnavailableGitClient` is used until you add one.
//
//  ⚠️ VERIFY-ON-DEVICE: this is the single file most likely to need small tweaks
//  on the first real build, because it depends on the exact module name and a few
//  enum/constant spellings of whichever libgit2 package you add. See SYNC.md for
//  the package + the handful of things to check (notably `git_credential_*` vs
//  the older `git_cred_*`, and the `Clibgit2` module name).
//
//  Conventions match the desktop (adapters/git/mod.rs): remote `origin`, branch =
//  configured else HEAD else `main`, and conflicts keep "ours" while writing
//  "theirs" to a `<name>.conflict.md` sibling so a pull is never blocked.
//

#if canImport(Clibgit2)

import Clibgit2
import Foundation

/// libgit2 needs a one-time process init. A static `let` is lazy + thread-safe.
private enum GitRuntime {
    static let initialized: Bool = { git_libgit2_init() >= 0 }()
    nonisolated static func ensureInit() { _ = initialized }
}

/// Box carrying credentials into the C credentials callback via its payload.
private final class GitCredBox: Sendable {
    let username: String
    let secret: String
    init(username: String, secret: String) {
        self.username = username
        self.secret = secret
    }
}

/// Non-capturing C callback. libgit2 calls this during fetch/push to obtain auth.
private nonisolated func gitCredentialsCallback(
    out: UnsafeMutablePointer<UnsafeMutablePointer<git_credential>?>?,
    url: UnsafePointer<CChar>?,
    usernameFromURL: UnsafePointer<CChar>?,
    allowedTypes: UInt32,
    payload: UnsafeMutableRawPointer?
) -> Int32 {
    guard let payload else { return -1 }
    let box = Unmanaged<GitCredBox>.fromOpaque(payload).takeUnretainedValue()
    if allowedTypes & GIT_CREDENTIAL_USERPASS_PLAINTEXT.rawValue != 0 {
        return git_credential_userpass_plaintext_new(out, box.username, box.secret)
    }
    // SSH key auth is a documented future enhancement (needs libssh2 in the build).
    return -1
}

struct LibGit2Client: GitClient {

    // All libgit2 `*_OPTIONS_VERSION` / `*_CALLBACKS_VERSION` macros are `1` in
    // libgit2 1.x; using the literal avoids depending on macro import.
    private static let optionsVersion: UInt32 = 1

    // MARK: GitClient

    nonisolated func ensureRepository(at root: URL, remoteURL: String) throws {
        GitRuntime.ensureInit()
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

        var repo: OpaquePointer?
        if git_repository_open(&repo, root.path) < 0 {
            try check(git_repository_init(&repo, root.path, 0))
        }
        defer { git_repository_free(repo) }

        var existing: OpaquePointer?
        if git_remote_lookup(&existing, repo, "origin") == 0 {
            git_remote_free(existing)
            try check(git_remote_set_url(repo, "origin", remoteURL))
        } else {
            var created: OpaquePointer?
            try check(git_remote_create(&created, repo, "origin", remoteURL))
            git_remote_free(created)
        }
    }

    nonisolated func prepareBranch(at root: URL, branch: String) throws {
        let repo = try openRepo(root)
        defer { git_repository_free(repo) }
        let refName = "refs/heads/\(branch)"
        if git_repository_head_unborn(repo) == 1 {
            // Fresh repo: point the (unborn) HEAD at the desired branch so the
            // first commit lands there.
            git_repository_set_head(repo, refName)
            return
        }
        // If the desired branch already exists locally, check it out.
        var ref: OpaquePointer?
        if git_reference_lookup(&ref, repo, refName) == 0 {
            git_reference_free(ref)
            git_repository_set_head(repo, refName)
        }
        // Otherwise keep the current branch (the coordinator resolves the branch
        // from HEAD when the user didn't configure one).
    }

    nonisolated func currentBranch(at root: URL) -> String? {
        guard let repo = try? openRepo(root) else { return nil }
        defer { git_repository_free(repo) }
        var ref: OpaquePointer?
        if git_repository_head(&ref, repo) < 0 { return nil }
        defer { git_reference_free(ref) }
        var namePtr: UnsafePointer<CChar>?
        if git_branch_name(&namePtr, ref) < 0 { return nil }
        return namePtr.map { String(cString: $0) }
    }

    @discardableResult
    nonisolated func commitAll(at root: URL, message: String, author: GitSignature) throws -> Bool {
        let repo = try openRepo(root)
        defer { git_repository_free(repo) }

        var index: OpaquePointer?
        try check(git_repository_index(&index, repo))
        defer { git_index_free(index) }

        // Stage additions + modifications, then deletions.
        try check(git_index_add_all(index, nil, 0, nil, nil))
        try check(git_index_update_all(index, nil, nil, nil))
        try check(git_index_write(index))

        var treeOid = git_oid()
        try check(git_index_write_tree(&treeOid, index))

        // Determine the parent (current HEAD), and short-circuit if the tree is
        // unchanged.
        var parent: OpaquePointer?
        var headOid = git_oid()
        let hasHead = git_reference_name_to_id(&headOid, repo, "HEAD") == 0
        if hasHead {
            try check(git_commit_lookup(&parent, repo, &headOid))
            if let parentTreeId = git_commit_tree_id(parent),
                withUnsafePointer(to: &treeOid, { git_oid_equal($0, parentTreeId) }) != 0
            {
                git_commit_free(parent)
                return false
            }
        }
        defer { if parent != nil { git_commit_free(parent) } }

        var tree: OpaquePointer?
        try check(git_tree_lookup(&tree, repo, &treeOid))
        defer { git_tree_free(tree) }

        var signature: UnsafeMutablePointer<git_signature>?
        try check(git_signature_now(&signature, author.name, author.email))
        defer { git_signature_free(signature) }

        var commitOid = git_oid()
        var parents: [OpaquePointer?] = parent != nil ? [parent] : []
        try parents.withUnsafeMutableBufferPointer { buffer in
            try check(
                git_commit_create(
                    &commitOid, repo, "HEAD", signature, signature, nil, message, tree,
                    buffer.count, buffer.baseAddress))
        }
        return true
    }

    nonisolated func pull(
        at root: URL, branch: String, credentials: GitCredentials
    ) throws -> GitPullOutcome {
        let repo = try openRepo(root)
        defer { git_repository_free(repo) }

        try fetchOrigin(repo: repo, credentials: credentials)

        // The remote-tracking ref may not exist yet (brand-new/empty remote).
        var theirOid = git_oid()
        if git_reference_name_to_id(&theirOid, repo, "refs/remotes/origin/\(branch)") != 0 {
            return .upToDate
        }

        var their: OpaquePointer?
        try check(git_annotated_commit_lookup(&their, repo, &theirOid))
        defer { git_annotated_commit_free(their) }

        var analysis = git_merge_analysis_t(rawValue: 0)
        var preference = git_merge_preference_t(rawValue: 0)
        var heads: [OpaquePointer?] = [their]
        try heads.withUnsafeMutableBufferPointer { buffer in
            try check(git_merge_analysis(&analysis, &preference, repo, buffer.baseAddress, 1))
        }

        if analysis.rawValue & GIT_MERGE_ANALYSIS_UP_TO_DATE.rawValue != 0 {
            return .upToDate
        }
        if analysis.rawValue & GIT_MERGE_ANALYSIS_FASTFORWARD.rawValue != 0 {
            try fastForward(repo: repo, to: &theirOid, branch: branch)
            return .fastForwarded
        }
        return try normalMerge(repo: repo, root: root, their: their, theirOid: &theirOid)
    }

    nonisolated func push(at root: URL, branch: String, credentials: GitCredentials) throws {
        let repo = try openRepo(root)
        defer { git_repository_free(repo) }

        var remote: OpaquePointer?
        try check(git_remote_lookup(&remote, repo, "origin"))
        defer { git_remote_free(remote) }

        try withCredentials(credentials) { payload in
            var callbacks = git_remote_callbacks()
            git_remote_init_callbacks(&callbacks, Self.optionsVersion)
            callbacks.credentials = gitCredentialsCallback
            callbacks.payload = payload

            var options = git_push_options()
            git_push_options_init(&options, Self.optionsVersion)
            options.callbacks = callbacks

            let refspec = "refs/heads/\(branch):refs/heads/\(branch)"
            try withGitStrArray([refspec]) { array in
                try check(git_remote_push(remote, &array, &options))
            }
        }
    }

    // MARK: Fetch / fast-forward / merge

    private nonisolated func fetchOrigin(repo: OpaquePointer, credentials: GitCredentials) throws {
        var remote: OpaquePointer?
        try check(git_remote_lookup(&remote, repo, "origin"))
        defer { git_remote_free(remote) }

        try withCredentials(credentials) { payload in
            var callbacks = git_remote_callbacks()
            git_remote_init_callbacks(&callbacks, Self.optionsVersion)
            callbacks.credentials = gitCredentialsCallback
            callbacks.payload = payload

            var options = git_fetch_options()
            git_fetch_options_init(&options, Self.optionsVersion)
            options.callbacks = callbacks

            try check(git_remote_fetch(remote, nil, &options, "fetch"))
        }
    }

    private nonisolated func fastForward(
        repo: OpaquePointer, to oid: inout git_oid, branch: String
    ) throws {
        var target: OpaquePointer?
        try check(git_object_lookup(&target, repo, &oid, GIT_OBJECT_COMMIT))
        defer { git_object_free(target) }

        var checkout = git_checkout_options()
        git_checkout_options_init(&checkout, Self.optionsVersion)
        checkout.checkout_strategy = GIT_CHECKOUT_SAFE.rawValue
        try check(git_checkout_tree(repo, target, &checkout))

        let refName = "refs/heads/\(branch)"
        var ref: OpaquePointer?
        if git_reference_lookup(&ref, repo, refName) == 0 {
            defer { git_reference_free(ref) }
            var newRef: OpaquePointer?
            try check(git_reference_set_target(&newRef, ref, &oid, "fast-forward"))
            git_reference_free(newRef)
        } else {
            var newRef: OpaquePointer?
            try check(git_reference_create(&newRef, repo, refName, &oid, 0, "fast-forward"))
            git_reference_free(newRef)
        }
        git_repository_set_head(repo, refName)
    }

    private nonisolated func normalMerge(
        repo: OpaquePointer, root: URL, their: OpaquePointer?, theirOid: inout git_oid
    ) throws -> GitPullOutcome {
        var mergeOptions = git_merge_options()
        git_merge_options_init(&mergeOptions, Self.optionsVersion)
        var checkoutOptions = git_checkout_options()
        git_checkout_options_init(&checkoutOptions, Self.optionsVersion)
        checkoutOptions.checkout_strategy =
            GIT_CHECKOUT_SAFE.rawValue | GIT_CHECKOUT_ALLOW_CONFLICTS.rawValue

        var heads: [OpaquePointer?] = [their]
        try heads.withUnsafeMutableBufferPointer { buffer in
            try check(git_merge(repo, buffer.baseAddress, 1, &mergeOptions, &checkoutOptions))
        }

        var index: OpaquePointer?
        try check(git_repository_index(&index, repo))
        defer { git_index_free(index) }

        var conflictPaths: [String] = []
        if git_index_has_conflicts(index) != 0 {
            conflictPaths = try resolveConflictsKeepingOurs(repo: repo, root: root, index: index)
        }
        try check(git_index_write(index))

        var treeOid = git_oid()
        try check(git_index_write_tree(&treeOid, index))
        var tree: OpaquePointer?
        try check(git_tree_lookup(&tree, repo, &treeOid))
        defer { git_tree_free(tree) }

        var headOid = git_oid()
        try check(git_reference_name_to_id(&headOid, repo, "HEAD"))
        var ourCommit: OpaquePointer?
        try check(git_commit_lookup(&ourCommit, repo, &headOid))
        defer { git_commit_free(ourCommit) }
        var theirCommit: OpaquePointer?
        try check(git_commit_lookup(&theirCommit, repo, &theirOid))
        defer { git_commit_free(theirCommit) }

        var signature: UnsafeMutablePointer<git_signature>?
        try check(
            git_signature_now(&signature, GitSignature.fallback.name, GitSignature.fallback.email))
        defer { git_signature_free(signature) }

        var commitOid = git_oid()
        var parents: [OpaquePointer?] = [ourCommit, theirCommit]
        try parents.withUnsafeMutableBufferPointer { buffer in
            try check(
                git_commit_create(
                    &commitOid, repo, "HEAD", signature, signature, nil, "Merge remote (iOS)",
                    tree, buffer.count, buffer.baseAddress))
        }

        git_repository_state_cleanup(repo)

        // Sync the working directory to the merged tree.
        var forceCheckout = git_checkout_options()
        git_checkout_options_init(&forceCheckout, Self.optionsVersion)
        forceCheckout.checkout_strategy = GIT_CHECKOUT_FORCE.rawValue
        git_checkout_head(repo, &forceCheckout)

        return conflictPaths.isEmpty ? .merged : .mergedWithConflicts(conflictPaths)
    }

    /// For each conflicted path: write OUR content to the working file (and stage
    /// it), and write THEIR content to `<name>.conflict.md` (and stage that).
    private nonisolated func resolveConflictsKeepingOurs(
        repo: OpaquePointer, root: URL, index: OpaquePointer?
    ) throws -> [String] {
        var paths: [String] = []
        var iterator: OpaquePointer?
        try check(git_index_conflict_iterator_new(&iterator, index))
        defer { git_index_conflict_iterator_free(iterator) }

        while true {
            var ancestor: UnsafePointer<git_index_entry>?
            var ours: UnsafePointer<git_index_entry>?
            var theirs: UnsafePointer<git_index_entry>?
            let rc = git_index_conflict_next(&ancestor, &ours, &theirs, iterator)
            if rc == GIT_ITEROVER.rawValue { break }
            try check(rc)

            guard let pathPtr = ours?.pointee.path ?? theirs?.pointee.path ?? ancestor?.pointee.path
            else { continue }
            let path = String(cString: pathPtr)
            let fileURL = root.appendingPathComponent(path)

            // Ours → working file.
            if let ours {
                var ourId = ours.pointee.id
                if let data = blobData(repo: repo, oid: &ourId) {
                    try? data.write(to: fileURL, options: .atomic)
                }
            } else {
                try? FileManager.default.removeItem(at: fileURL)
            }

            git_index_conflict_remove(index, path)
            if ours != nil {
                git_index_add_bypath(index, path)
            } else {
                git_index_remove_bypath(index, path)
            }

            // Theirs → `<name>.conflict.md`.
            if let theirs {
                var theirId = theirs.pointee.id
                if let data = blobData(repo: repo, oid: &theirId) {
                    let conflictRel = conflictSiblingPath(path)
                    let conflictURL = root.appendingPathComponent(conflictRel)
                    try? FileManager.default.createDirectory(
                        at: conflictURL.deletingLastPathComponent(),
                        withIntermediateDirectories: true)
                    try? data.write(to: conflictURL, options: .atomic)
                    git_index_add_bypath(index, conflictRel)
                }
            }

            paths.append(path)
        }
        return paths
    }

    // MARK: Low-level helpers

    private nonisolated func openRepo(_ root: URL) throws -> OpaquePointer {
        GitRuntime.ensureInit()
        var repo: OpaquePointer?
        try check(git_repository_open(&repo, root.path))
        guard let repo else { throw GitSyncError.git("Failed to open repository.") }
        return repo
    }

    private nonisolated func blobData(repo: OpaquePointer, oid: inout git_oid) -> Data? {
        var blob: OpaquePointer?
        if git_blob_lookup(&blob, repo, &oid) < 0 { return nil }
        defer { git_blob_free(blob) }
        let size = git_blob_rawsize(blob)
        guard let raw = git_blob_rawcontent(blob) else { return Data() }
        return Data(bytes: raw, count: Int(size))
    }

    private nonisolated func conflictSiblingPath(_ path: String) -> String {
        // "a/b/note.md" -> "a/b/note.conflict.md"
        if let dot = path.lastIndex(of: "."),
            !path[path.index(after: dot)...].contains("/")
        {
            let stem = path[..<dot]
            let ext = path[path.index(after: dot)...]
            return "\(stem).conflict.\(ext)"
        }
        return "\(path).conflict"
    }

    private nonisolated func withCredentials<T>(
        _ credentials: GitCredentials, _ body: (UnsafeMutableRawPointer) throws -> T
    ) rethrows -> T {
        let box = GitCredBox(username: credentials.username, secret: credentials.secret)
        let payload = Unmanaged.passRetained(box).toOpaque()
        defer { Unmanaged<GitCredBox>.fromOpaque(payload).release() }
        return try body(payload)
    }

    private nonisolated func withGitStrArray<T>(
        _ strings: [String], _ body: (inout git_strarray) throws -> T
    ) rethrows -> T {
        var cStrings: [UnsafeMutablePointer<CChar>?] = strings.map { strdup($0) }
        defer { cStrings.forEach { free($0) } }
        return try cStrings.withUnsafeMutableBufferPointer { buffer in
            var array = git_strarray()
            array.strings = buffer.baseAddress
            array.count = strings.count
            return try body(&array)
        }
    }

    private nonisolated func check(_ code: Int32) throws {
        if code >= 0 { return }
        let message: String
        if let err = git_error_last() {
            message = String(cString: err.pointee.message)
        } else {
            message = "git error \(code)"
        }
        let lower = message.lowercased()
        if lower.contains("auth") || lower.contains("401") || lower.contains("403")
            || lower.contains("credential")
        {
            throw GitSyncError.auth(message)
        }
        throw GitSyncError.git(message)
    }
}

#endif
