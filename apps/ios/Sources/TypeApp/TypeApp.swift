import SwiftUI
import TypeDomain
import TypeCoreAdapter

@main struct TypeApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: NotesModel?
    @State private var startupError: String?
    @State private var backgroundSave = BackgroundSave()

    var body: some Scene {
        WindowGroup {
            Group {
                if let model {
                    LibraryView(model: model)
                } else if let startupError {
                    ContentUnavailableView("Could not open Type", systemImage: "exclamationmark.triangle",
                                           description: Text(startupError))
                } else {
                    ProgressView().task { boot() }
                }
            }
            .tint(.primary)
            .onChange(of: scenePhase) { _, phase in
                guard phase != .active, let model else { return }
                backgroundSave.flush(model)
            }
        }
    }

    @MainActor private func boot() {
        do {
            let files = FileManager.default
            let appData = try files.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                        appropriateFor: nil, create: true).appendingPathComponent("TypeSwift")
            let documents = try files.url(for: .documentDirectory, in: .userDomainMask,
                                          appropriateFor: nil, create: true)
            let repository = try RustNotesRepository(appData: appData, documents: documents)
            model = NotesModel(repository: repository,
                               recovery: FileDraftRecovery(url: appData.appendingPathComponent("draft.json")))
        } catch { startupError = error.localizedDescription }
    }
}
