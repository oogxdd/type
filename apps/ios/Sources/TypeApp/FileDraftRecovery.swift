import Foundation
import TypeDomain

/// This initial shell supports only its own unencrypted workspace.
/// Before adding encryption, replace this with a recovery store that seals drafts.
@MainActor final class FileDraftRecovery: DraftRecovery {
    private let url: URL
    init(url: URL) { self.url = url }

    func load() throws -> Draft? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(Draft.self, from: Data(contentsOf: url))
    }

    func store(_ draft: Draft?) throws {
        if let draft {
            try JSONEncoder().encode(draft).write(to: url, options: [.atomic, .completeFileProtection])
        } else if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }
}
