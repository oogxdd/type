//
//  WriteView.swift
//  Type
//
//  The blank page. You open the app and type directly. Swipe up (or tap the
//  commit button) to save the current note — it slides up and away — and a fresh
//  blank page takes its place. This is the one interaction carried over verbatim
//  from the brief.
//
//  Gesture note: the swipe-up uses a `simultaneousGesture` with a conservative
//  threshold so it does not fight text selection/scrolling, and there is always a
//  commit button as a fallback. Thresholds are worth tuning on a real device.
//

import SwiftUI

struct WriteView: View {
    @Environment(AppState.self) private var app
    @FocusState private var focused: Bool
    @State private var committing = false

    private var hasText: Bool {
        !app.draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        @Bindable var app = app

        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                TextEditor(text: $app.draftText)
                    .font(.title3)
                    .lineSpacing(3)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 18)
                    .padding(.top, 12)
                    .focused($focused)
                    .offset(y: committing ? -geo.size.height : 0)
                    .opacity(committing ? 0 : 1)

                if app.draftText.isEmpty && !committing {
                    Text("Start typing…")
                        .font(.title3)
                        .foregroundStyle(.tertiary)
                        .padding(.horizontal, 23)
                        .padding(.top, 20)
                        .allowsHitTesting(false)
                }

                if hasText && !committing {
                    HStack {
                        Spacer()
                        Button(action: commit) {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.title2)
                                .symbolRenderingMode(.hierarchical)
                        }
                        .padding(.trailing, 14)
                        .padding(.top, 8)
                    }
                    .accessibilityLabel("Save and start a new note")
                }

                VStack {
                    Spacer()
                    if hasText {
                        Label("Swipe up for a new note", systemImage: "chevron.up")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .frame(maxWidth: .infinity)
                            .padding(.bottom, 6)
                            .allowsHitTesting(false)
                    }
                }
            }
            .contentShape(Rectangle())
            .simultaneousGesture(
                DragGesture(minimumDistance: 30)
                    .onEnded { value in
                        if value.translation.height < -110 && value.velocity.height < -200 {
                            commit()
                        }
                    }
            )
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .onAppear { focused = true }
    }

    private func commit() {
        guard hasText else { return }
        focused = false
        withAnimation(.easeIn(duration: 0.22)) { committing = true }
        Task {
            try? await Task.sleep(for: .milliseconds(240))
            app.commitDraft()
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { committing = false }
            focused = true
        }
    }
}
