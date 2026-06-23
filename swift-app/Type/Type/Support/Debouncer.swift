//
//  Debouncer.swift
//  Type
//
//  Small main-actor debouncer used for the 400 ms autosave (matching the desktop
//  editor's debounce).
//

import Foundation

@MainActor
final class Debouncer {
    private var task: Task<Void, Never>?
    private let interval: Duration

    init(milliseconds: Int) {
        interval = .milliseconds(milliseconds)
    }

    func call(_ action: @escaping @MainActor () -> Void) {
        task?.cancel()
        task = Task { [interval] in
            try? await Task.sleep(for: interval)
            if Task.isCancelled { return }
            action()
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
    }
}
