//
//  NoteDocument.swift
//  Type
//
//  Parse + render the YAML-ish front-matter stored at the top of every note
//  `.md` file. This is byte-compatible with the Rust backend
//  (`src-tauri/src/adapters/notes/front_matter.rs`); keep the two in lockstep.
//
//  Compatibility contract (verified against the Rust source):
//    * A file has front-matter only if it starts with `---\n` and contains a
//      `\n---\n` close marker. CRLF is normalized to LF before parsing.
//    * Known integer fields parse as Int64; on parse failure the raw line is
//      preserved as a passthrough line (and the field stays nil).
//    * Known string fields are only set when non-empty.
//    * Unknown keys are preserved verbatim as passthrough lines and re-emitted
//      after the known fields, so data written by a newer desktop is never lost.
//    * On render, values made of only [A-Za-z0-9._-] are emitted raw; anything
//      else is wrapped using Rust's `{:?}` debug-string quoting (e.g. paths that
//      contain `/`).
//    * The header is closed with `---\n\n` and the body follows. We strip the one
//      separator newline so `body` is exactly what the editor shows; rendering
//      re-adds it, producing identical bytes to the desktop writer.
//

import Foundation

/// Front-matter fields. Field set + serialization order match the Rust
/// `NoteFrontMatter` struct exactly.
struct NoteFrontMatter: Equatable {
    var id: String?
    var createdMs: Int64?
    var updatedMs: Int64?
    var type: String?
    var archivedMs: Int64?
    var reviewedMs: Int64?
    var recordingAudioPath: String?
    var handwritingAttachmentPath: String?
    var transcriptionStatus: String?
    var transcriptionError: String?
    var transcriptionUpdatedMs: Int64?
    var transcriptionId: String?
    var ocrStatus: String?
    var ocrError: String?
    var ocrUpdatedMs: Int64?
    /// Unknown header lines preserved verbatim (e.g. fields a newer desktop wrote).
    var passthroughLines: [String] = []
}

/// A parsed note: front-matter plus the logical body the user edits.
struct NoteDocument: Equatable {
    var frontMatter: NoteFrontMatter
    var body: String

    init(frontMatter: NoteFrontMatter = NoteFrontMatter(), body: String = "") {
        self.frontMatter = frontMatter
        self.body = body
    }
}

extension NoteDocument {
    // MARK: Parse

    nonisolated static func parse(_ raw: String) -> NoteDocument {
        var meta = NoteFrontMatter()
        let normalized = raw.replacingOccurrences(of: "\r\n", with: "\n")

        guard normalized.hasPrefix("---\n") else {
            // No front-matter: return the raw text unchanged (matches Rust).
            return NoteDocument(frontMatter: meta, body: raw)
        }

        let searchStart = normalized.index(normalized.startIndex, offsetBy: 4)
        guard
            let close = normalized.range(
                of: "\n---\n", range: searchStart..<normalized.endIndex)
        else {
            return NoteDocument(frontMatter: meta, body: raw)
        }

        let header = normalized[searchStart..<close.lowerBound]
        let rawBody = String(normalized[close.upperBound...])

        for lineSlice in header.split(separator: "\n", omittingEmptySubsequences: false) {
            let trimmed = lineSlice.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { continue }
            guard let colon = trimmed.firstIndex(of: ":") else {
                meta.passthroughLines.append(trimmed)
                continue
            }
            let key = trimmed[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let rawValue = String(trimmed[trimmed.index(after: colon)...])
                .trimmingCharacters(in: .whitespaces)
            let value = unquote(rawValue)
            assign(&meta, key: key, value: value, rawLine: trimmed)
        }

        return NoteDocument(frontMatter: meta, body: dropHeaderSeparator(rawBody))
    }

    /// The body produced by parsing starts with the single separator newline that
    /// `---\n\n` introduced; drop exactly one leading newline so the editor does
    /// not show a phantom blank line.
    nonisolated private static func dropHeaderSeparator(_ body: String) -> String {
        body.hasPrefix("\n") ? String(body.dropFirst()) : body
    }

    /// Mirror of Rust's `value_raw.trim().trim_matches('"').trim_matches('\'')` —
    /// strips surrounding double quotes, then surrounding single quotes. It does
    /// not un-escape interior characters (neither does the Rust parser); our
    /// fields never contain interior quotes so this round-trips cleanly.
    nonisolated private static func unquote(_ value: String) -> String {
        var v = Substring(value)
        while v.first == "\"" { v = v.dropFirst() }
        while v.last == "\"" { v = v.dropLast() }
        while v.first == "'" { v = v.dropFirst() }
        while v.last == "'" { v = v.dropLast() }
        return String(v)
    }

    nonisolated private static func assign(
        _ meta: inout NoteFrontMatter, key: String, value: String, rawLine: String
    ) {
        func setString(_ kp: WritableKeyPath<NoteFrontMatter, String?>) {
            if !value.isEmpty { meta[keyPath: kp] = value }
        }
        func setInt(_ kp: WritableKeyPath<NoteFrontMatter, Int64?>) {
            if let parsed = Int64(value) {
                meta[keyPath: kp] = parsed
            } else {
                meta.passthroughLines.append(rawLine)
            }
        }

        switch key {
        case "id": setString(\.id)
        case "created_ms": setInt(\.createdMs)
        case "updated_ms": setInt(\.updatedMs)
        case "type": setString(\.type)
        case "archived_ms": setInt(\.archivedMs)
        case "reviewed_ms": setInt(\.reviewedMs)
        case "recording_audio_path": setString(\.recordingAudioPath)
        case "handwriting_attachment_path": setString(\.handwritingAttachmentPath)
        case "transcription_status": setString(\.transcriptionStatus)
        case "transcription_error": setString(\.transcriptionError)
        case "transcription_updated_ms": setInt(\.transcriptionUpdatedMs)
        case "transcription_id": setString(\.transcriptionId)
        case "ocr_status": setString(\.ocrStatus)
        case "ocr_error": setString(\.ocrError)
        case "ocr_updated_ms": setInt(\.ocrUpdatedMs)
        default: meta.passthroughLines.append(rawLine)
        }
    }

    // MARK: Render

    nonisolated func render() -> String {
        var out = "---\n"
        let fm = frontMatter

        func emitString(_ key: String, _ value: String?) {
            if let value { out += "\(key): \(NoteDocument.safeValue(value))\n" }
        }
        func emitInt(_ key: String, _ value: Int64?) {
            if let value { out += "\(key): \(value)\n" }
        }

        emitString("id", fm.id)
        emitInt("created_ms", fm.createdMs)
        emitInt("updated_ms", fm.updatedMs)
        emitString("type", fm.type)
        emitInt("archived_ms", fm.archivedMs)
        emitInt("reviewed_ms", fm.reviewedMs)
        emitString("recording_audio_path", fm.recordingAudioPath)
        emitString("handwriting_attachment_path", fm.handwritingAttachmentPath)
        emitString("transcription_status", fm.transcriptionStatus)
        emitString("transcription_error", fm.transcriptionError)
        emitInt("transcription_updated_ms", fm.transcriptionUpdatedMs)
        emitString("transcription_id", fm.transcriptionId)
        emitString("ocr_status", fm.ocrStatus)
        emitString("ocr_error", fm.ocrError)
        emitInt("ocr_updated_ms", fm.ocrUpdatedMs)
        for line in fm.passthroughLines { out += line + "\n" }

        out += "---\n\n"
        out += body
        return out
    }

    /// Mirror of Rust's `front_matter_safe_value`: emit raw when every character
    /// is ASCII alphanumeric or one of `-`, `_`, `.`; otherwise debug-quote.
    nonisolated static func safeValue(_ value: String) -> String {
        let isSafe = value.unicodeScalars.allSatisfy { scalar in
            let c = Character(scalar)
            return (scalar.isASCII && (c.isLetter || c.isNumber))
                || c == "-" || c == "_" || c == "."
        }
        return isSafe ? value : debugQuote(value)
    }

    /// Faithful subset of Rust's `{:?}` string formatting for the characters our
    /// front-matter values can actually contain (paths, ids, statuses).
    nonisolated static func debugQuote(_ s: String) -> String {
        var out = "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default: out.unicodeScalars.append(scalar)
            }
        }
        out += "\""
        return out
    }
}
