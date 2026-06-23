//
//  SyncSettingsView.swift
//  Type
//
//  Configure the per-workspace git remote + credentials and run a sync. The
//  remote URL / username / branch / commit identity are stored in workspace
//  settings; the token is stored in the Keychain.
//

import SwiftUI

struct SyncSettingsView: View {
    @Environment(AppState.self) private var app

    @State private var remoteURL = ""
    @State private var branch = ""
    @State private var username = ""
    @State private var token = ""
    @State private var authorName = ""
    @State private var authorEmail = ""

    var body: some View {
        Form {
            if !app.git.isAvailable {
                Section {
                    Label {
                        Text(
                            "Git support isn't compiled in yet. Add the libgit2 Swift package (see SYNC.md) to enable syncing."
                        )
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }
                    .font(.footnote)
                }
            }

            Section {
                TextField("https://github.com/you/notes.git", text: $remoteURL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                TextField("Branch (default: main)", text: $branch)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } header: {
                Text("Remote")
            } footer: {
                Text("Use the same repository your desktop app syncs to.")
            }

            Section {
                TextField("Username", text: $username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Token or password", text: $token)
            } header: {
                Text("Authentication")
            } footer: {
                Text(
                    "For HTTPS remotes (e.g. GitHub) use a Personal Access Token as the password. The token is stored in the iOS Keychain."
                )
            }

            Section("Commit identity") {
                TextField("Name", text: $authorName)
                    .autocorrectionDisabled()
                TextField("Email", text: $authorEmail)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.emailAddress)
            }

            Section {
                Button(action: syncNow) {
                    HStack {
                        if app.git.isSyncing { ProgressView().controlSize(.small) }
                        Text(app.git.isSyncing ? "Syncing…" : "Sync now")
                    }
                }
                .disabled(app.git.isSyncing || remoteURL.isEmpty)

                if !app.git.message.isEmpty {
                    Label(app.git.message, systemImage: statusIcon)
                        .font(.footnote)
                        .foregroundStyle(statusColor)
                }
                if let ms = app.git.lastSyncedMs {
                    LabeledContent("Last synced", value: RelativeDate.string(fromMs: ms))
                }
            }
        }
        .navigationTitle("Sync")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: load)
        .onDisappear(perform: save)
    }

    private var statusIcon: String {
        switch app.git.phase {
        case .success: return "checkmark.circle.fill"
        case .error: return "xmark.octagon.fill"
        default: return "arrow.triangle.2.circlepath"
        }
    }

    private var statusColor: Color {
        switch app.git.phase {
        case .success: return .green
        case .error: return .red
        default: return .secondary
        }
    }

    private func load() {
        let settings = app.activeWorkspace.settings
        remoteURL = settings.gitRemoteURL
        branch = settings.gitBranch
        username = settings.gitUsername
        authorName = settings.gitAuthorName
        authorEmail = settings.gitAuthorEmail
        token = app.gitToken()
    }

    private func save() {
        app.updateActiveSettings {
            $0.gitRemoteURL = remoteURL.trimmingCharacters(in: .whitespaces)
            $0.gitBranch = branch.trimmingCharacters(in: .whitespaces)
            $0.gitUsername = username.trimmingCharacters(in: .whitespaces)
            $0.gitAuthorName = authorName
            $0.gitAuthorEmail = authorEmail.trimmingCharacters(in: .whitespaces)
        }
        app.setGitToken(token)
    }

    private func syncNow() {
        save()
        Task { await app.syncNow() }
    }
}
