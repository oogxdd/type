import UIKit
import TypeDomain

/// Ending the OS assertion on expiration does not cancel the Rust operation.
/// The durable draft is already written before we acquire this extra time.
@MainActor final class BackgroundSave {
    private var token: UIBackgroundTaskIdentifier = .invalid
    private var running = false

    func flush(_ model: NotesModel) {
        guard !running else { return }
        running = true
        token = UIApplication.shared.beginBackgroundTask(withName: "Save note") { [weak self] in
            MainActor.assumeIsolated { self?.end() }
        }
        Task {
            await model.flush()
            end()
            running = false
        }
    }

    private func end() {
        guard token != .invalid else { return }
        UIApplication.shared.endBackgroundTask(token)
        token = .invalid
    }
}
