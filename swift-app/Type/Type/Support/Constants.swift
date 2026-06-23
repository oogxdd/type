//
//  Constants.swift
//  Type
//
//  On-disk + app-wide constants. The notes layout constants MUST stay in sync
//  with the Tauri/Rust backend (`src-tauri/src/adapters/notes/mod.rs` and
//  `src-tauri/src/lib.rs`) so the same git repo round-trips between desktop and
//  iOS without either side corrupting the other's data.
//

import Foundation

enum AppConstants {
    /// Custom URL scheme used by the home-screen widget deep link (`type://record`).
    /// Declared in the app target's Info settings (`CFBundleURLTypes`).
    static let urlScheme = "type"

    /// App Group shared between the app and the widget / Live Activity extension.
    /// You MUST enable this App Group capability on BOTH the `Type` and
    /// `Type Record WidgetExtension` targets in Signing & Capabilities.
    static let appGroupIdentifier = "group.com.digital.Type"
}

/// Folder + file conventions. Mirror of the Rust backend constants. Do not change
/// the spellings — in particular the "Archieve" misspelling is intentional and
/// persisted in real user data.
enum NotesLayout {
    static let feedFolder = "Feed"
    /// Intentional misspelling — matches persisted desktop data. Do NOT "fix" it.
    static let archiveFolder = "Archieve"
    static let recordingsFolder = "Recordings"
    static let attachmentsFolder = "Attachments"
    static let legacyUnsortedFolder = "Unsorted"
    static let legacyRecordingsFolder = "_Recordings"
    static let orderFileName = ".notes-order.json"

    /// Hidden from the tree when they appear at the root level (storage-only).
    static let hiddenRootFolders: Set<String> = [
        recordingsFolder, attachmentsFolder, legacyRecordingsFolder,
    ]

    /// Always exist; cannot be renamed or deleted by the user.
    static let protectedFolders: Set<String> = [
        feedFolder, archiveFolder, legacyUnsortedFolder,
        attachmentsFolder, recordingsFolder, legacyRecordingsFolder,
    ]

    /// Created on first run and shown in the folder tree.
    static let visibleSystemFolders = [feedFolder, archiveFolder]

    /// Created on first run (includes hidden storage folders).
    static let requiredSystemFolders = [
        feedFolder, archiveFolder, attachmentsFolder, recordingsFolder,
    ]
}

/// Transcription status values written to front-matter `transcription_status`.
/// Mirror of the Rust `RECORDING_STATUS_*` constants.
enum TranscriptionStatus {
    static let pending = "pending"
    static let queued = "queued"
    static let processing = "processing"
    static let completed = "completed"
    static let failed = "failed"
}

/// front-matter `type` value for recording notes (Rust `RECORDING_FRONTMATTER_TYPE`).
let kRecordingNoteType = "audio_recording"
