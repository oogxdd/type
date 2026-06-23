//
//  RootView.swift
//  Type
//
//  Top-level tab composition. The app opens on Write (the blank page) per the
//  product brief; Browse and Settings are secondary. The Record tab is added in
//  Stage 3.
//

import SwiftUI

struct RootView: View {
    @Environment(AppState.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @State private var selection: Tab = .write

    enum Tab: Hashable { case write, browse, settings }

    var body: some View {
        TabView(selection: $selection) {
            WriteView()
                .tabItem { Label("Write", systemImage: "square.and.pencil") }
                .tag(Tab.write)

            BrowseView()
                .tabItem { Label("Browse", systemImage: "folder") }
                .tag(Tab.browse)

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(Tab.settings)
        }
        .onChange(of: scenePhase) { _, phase in
            // Persist the draft when the app goes to the background so nothing is
            // lost (the desktop does the same on visibility change).
            if phase != .active {
                app.commitDraft()
            }
        }
        .overlay(alignment: .top) {
            if let error = app.loadError {
                Text(error)
                    .font(.footnote)
                    .padding(8)
                    .background(.red.opacity(0.9), in: Capsule())
                    .foregroundStyle(.white)
                    .padding(.top, 4)
                    .transition(.move(edge: .top))
                    .onTapGesture { app.loadError = nil }
            }
        }
    }
}
