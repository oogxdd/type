//
//  RecordingActivityAttributes.swift
//  Type  +  Type Record Widget   (DUPLICATED — keep both copies identical)
//
//  The Live Activity contract. Both the app (which starts/updates/ends the
//  activity) and the widget extension (which renders it) need this exact type,
//  so it is duplicated into both targets:
//
//      Type/Type/Recording/Shared/RecordingActivityAttributes.swift   (app)
//      Type/Type Record Widget/RecordingActivityAttributes.swift      (widget)
//
//  `ContentState.startedAt` lets the lock-screen UI render a self-updating
//  elapsed-time clock via `Text(timerInterval:)` without the app pushing an
//  update every second.
//

import ActivityKit
import Foundation

struct RecordingActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// When the (current) recording segment started — drives the live timer.
        var startedAt: Date
        /// Paused recordings freeze the timer and swap the button.
        var isPaused: Bool
    }

    /// Static for the life of the activity — shown as a subtitle.
    var workspaceName: String
}
