//
//  TypeApp.swift
//  Type
//
//  App entry point. File-based notes (no SwiftData); a single `AppState` owns the
//  active workspace and its store.
//

import SwiftUI

@main
struct TypeApp: App {
    @State private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .onOpenURL { url in
                    appState.handleDeepLink(url)
                }
        }
    }
}
