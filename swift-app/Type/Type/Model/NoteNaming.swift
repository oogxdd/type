//
//  NoteNaming.swift
//  Type
//
//  Note IDs, content slugs, and unique filename allocation. Port of
//  `src-tauri/src/adapters/notes/naming.rs`. Filenames produced here are
//  interchangeable with the desktop app's.
//

import Foundation

/// Filename strategy for new notes (mirror of the Rust `NoteFileNameFormat`).
enum NoteFileNameFormat: String, Codable, CaseIterable, Sendable {
    /// `YYYY-MM-DDTHH-mm-ssZ-<slug>.md` (default).
    case utcTimestampSlug = "utc_timestamp_slug"
    /// `<uuidv7>.md`.
    case uuidV7 = "uuid_v7"
    /// `<uuidv7-prefix>-<slug>.md`.
    case uuidV7PrefixSlug = "uuid_v7_prefix_slug"
}

/// Minimal UUIDv7 generator (Foundation's `UUID` is v4). Layout: 48-bit big-endian
/// unix-millis timestamp, version 7, variant 10, the remainder random.
enum UUIDv7 {
    nonisolated static func generate(now ms: Int64 = Int64(Date().timeIntervalSince1970 * 1000))
        -> String
    {
        var bytes = [UInt8](repeating: 0, count: 16)
        let t = UInt64(bitPattern: ms)
        bytes[0] = UInt8((t >> 40) & 0xff)
        bytes[1] = UInt8((t >> 32) & 0xff)
        bytes[2] = UInt8((t >> 24) & 0xff)
        bytes[3] = UInt8((t >> 16) & 0xff)
        bytes[4] = UInt8((t >> 8) & 0xff)
        bytes[5] = UInt8(t & 0xff)
        for i in 6..<16 { bytes[i] = UInt8.random(in: 0...255) }
        bytes[6] = (bytes[6] & 0x0f) | 0x70  // version 7
        bytes[8] = (bytes[8] & 0x3f) | 0x80  // variant 10xx
        func hex(_ range: Range<Int>) -> String {
            range.map { String(format: "%02x", bytes[$0]) }.joined()
        }
        return "\(hex(0..<4))-\(hex(4..<6))-\(hex(6..<8))-\(hex(8..<10))-\(hex(10..<16))"
    }
}

enum NoteNaming {
    // MARK: Slugging (port of `slug_from_content`)

    nonisolated static func slug(from content: String, fallback: String) -> String {
        let maxWords = 8
        let maxChars = 56
        let minContentChars = 8

        var normalized = ""
        normalized.reserveCapacity(content.count * 2)
        for ch in content {
            if ch.isLetter || ch.isNumber || ch == "-" || ch == "_" || ch.isWhitespace {
                normalized += String(ch).lowercased()
            } else {
                normalized += " "
            }
        }

        let tokens =
            normalized
            .split { $0.isWhitespace || $0 == "-" || $0 == "_" }
            .map(String.init)
            .filter { !$0.isEmpty }

        var words: [String] = []
        var index = 0
        while index < tokens.count && words.count < maxWords {
            // Drop the `NV_EMPTY_LINE_TOKEN_<hash>` noise emitted by the editor.
            if index + 3 < tokens.count
                && tokens[index] == "nv" && tokens[index + 1] == "empty"
                && tokens[index + 2] == "line" && tokens[index + 3] == "token"
            {
                index += 4
                if index < tokens.count && isNoiseHashToken(tokens[index]) { index += 1 }
                continue
            }
            let token = tokens[index]
            index += 1
            if token.hasPrefix("http") || token.hasPrefix("www") { continue }
            words.append(token)
        }

        var slug = words.isEmpty ? fallback : words.joined(separator: "-")
        if slug.count > maxChars { slug = String(slug.prefix(maxChars)) }
        while slug.hasSuffix("-") { slug.removeLast() }

        if slug.isEmpty || slugContentCharCount(slug) < minContentChars { return fallback }
        return slug
    }

    nonisolated private static func isNoiseHashToken(_ value: String) -> Bool {
        !value.isEmpty && value.count <= 32
            && value.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) }
    }

    nonisolated private static func slugContentCharCount(_ value: String) -> Int {
        value.reduce(into: 0) { count, ch in if ch != "-" { count += 1 } }
    }

    // MARK: Filename allocation (port of `allocate_note_file_name`)

    /// Allocate a unique filename. `fileExists` is called with each candidate so
    /// the caller controls collision checks against the real directory.
    nonisolated static func allocateFileName(
        format: NoteFileNameFormat,
        timestampMs: Int64,
        noteId: String,
        content: String,
        fallbackSlug: String,
        fileExists: (String) -> Bool
    ) -> String {
        switch format {
        case .utcTimestampSlug:
            let prefix = utcFilenameTimestamp(timestampMs)
            let slug = slug(from: content, fallback: fallbackSlug)
            return allocatePrefixed(prefix: prefix, slug: slug, fileExists: fileExists)
        case .uuidV7:
            return allocateUUID(noteId: noteId, fileExists: fileExists)
        case .uuidV7PrefixSlug:
            let prefix = uuidPrefixWithTimestamp(noteId)
            let slug = slug(from: content, fallback: fallbackSlug)
            return allocatePrefixed(prefix: prefix, slug: slug, fileExists: fileExists)
        }
    }

    nonisolated private static func allocatePrefixed(
        prefix: String, slug: String, fileExists: (String) -> Bool
    ) -> String {
        for attempt in 0...512 {
            let candidate =
                attempt == 0 ? "\(prefix)-\(slug).md" : "\(prefix)-\(slug)-\(attempt).md"
            if !fileExists(candidate) { return candidate }
        }
        // Extremely unlikely; fall back to a UUID to guarantee uniqueness.
        return "\(prefix)-\(slug)-\(UUIDv7.generate()).md"
    }

    nonisolated private static func allocateUUID(
        noteId: String, fileExists: (String) -> Bool
    ) -> String {
        let base = noteId.lowercased()
        for attempt in 0...512 {
            let candidate = attempt == 0 ? "\(base).md" : "\(base)-\(attempt).md"
            if !fileExists(candidate) { return candidate }
        }
        return "\(base)-\(UUIDv7.generate()).md"
    }

    // MARK: Timestamp / UUID helpers

    /// `YYYY-MM-DDTHH-mm-ssZ` in UTC (port of `utc_note_filename_timestamp`).
    nonisolated static func utcFilenameTimestamp(_ ms: Int64) -> String {
        let date = Date(timeIntervalSince1970: Double(ms) / 1000)
        return utcFormatter.string(from: date)
    }

    nonisolated private static let utcFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd'T'HH-mm-ss'Z'"
        return f
    }()

    /// First 13 characters of the UUID (port of `uuid_prefix_with_timestamp`).
    nonisolated static func uuidPrefixWithTimestamp(_ noteId: String) -> String {
        String(noteId.lowercased().prefix(13))
    }

    /// Everything after the timestamp segments of a UUID
    /// (port of `uuid_tail_without_timestamp_prefix`). Used for fallback slugs.
    nonisolated static func uuidTailWithoutTimestampPrefix(_ noteId: String) -> String {
        let parts = noteId.split(separator: "-")
        if parts.count >= 5 {
            return parts[2...].joined(separator: "-").lowercased()
        }
        return noteId.lowercased()
    }
}
