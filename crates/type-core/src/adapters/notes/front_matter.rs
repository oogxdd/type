//! Front-matter: parse and render the YAML-ish header stored on each note.

use std::{fs, path::Path};

use crate::encrypt_note_body_for_write;

use super::NoteFrontMatter;

/// Parse `---` delimited YAML-ish front-matter from a raw markdown string.
pub fn parse_note_front_matter(raw: &str) -> (NoteFrontMatter, String) {
    let mut meta = NoteFrontMatter::default();
    let normalized = raw.replace("\r\n", "\n");
    if !normalized.starts_with("---\n") {
        return (meta, raw.to_string());
    }
    let Some(close_marker_index) = normalized[4..].find("\n---\n") else {
        return (meta, raw.to_string());
    };
    let header_end = 4 + close_marker_index;
    let header = &normalized[4..header_end];
    // `render_note_with_front_matter` writes "---\n\n" before the body, so the
    // blank line after the closing marker is a separator, not content. Drop one
    // newline to stay its inverse: without this, every read → write round trip
    // (the phone reconciling its draft, a sync rewriting a note) prepended
    // another blank line and the first line of the note drifted down the page.
    let body_start = header_end + 5;
    let body = normalized[body_start..]
        .strip_prefix('\n')
        .unwrap_or(&normalized[body_start..]);

    for line in header.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some((key_raw, value_raw)) = trimmed.split_once(':') else {
            meta.passthrough_lines.push(trimmed.to_string());
            continue;
        };
        let key = key_raw.trim().to_lowercase();
        let value = value_raw
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        match key.as_str() {
            "tags" => {
                let raw_tags = value_raw.trim();
                let parsed = serde_json::from_str::<Vec<String>>(raw_tags).ok().or_else(|| {
                    let inner = raw_tags.strip_prefix('[')?.strip_suffix(']')?;
                    let tags: Vec<String> = inner.split(',').map(|v| v.trim().trim_matches('\'').to_string()).filter(|v| !v.is_empty()).collect();
                    tags.iter().all(|tag| crate::domain::tag_registry::valid_tag_name(tag)).then_some(tags)
                });
                if let Some(tags) = parsed { meta.tags = Some(tags); }
                else { meta.passthrough_lines.push(trimmed.to_string()); }
            }
            "id" => {
                if !value.is_empty() {
                    meta.id = Some(value);
                }
            }
            "created_ms" => {
                if let Ok(parsed) = value.parse::<i64>() {
                    meta.created_ms = Some(parsed);
                } else {
                    meta.passthrough_lines.push(trimmed.to_string());
                }
            }
            "updated_ms" => {
                if let Ok(parsed) = value.parse::<i64>() {
                    meta.updated_ms = Some(parsed);
                } else {
                    meta.passthrough_lines.push(trimmed.to_string());
                }
            }
            "type" => {
                if !value.is_empty() {
                    meta.note_type = Some(value);
                }
            }
            "archived_ms" => {
                if let Ok(parsed) = value.parse::<i64>() {
                    meta.archived_ms = Some(parsed);
                } else {
                    meta.passthrough_lines.push(trimmed.to_string());
                }
            }
            "reviewed_ms" => {
                if let Ok(parsed) = value.parse::<i64>() {
                    meta.reviewed_ms = Some(parsed);
                } else {
                    meta.passthrough_lines.push(trimmed.to_string());
                }
            }
            "recording_audio_path" => {
                if !value.is_empty() {
                    meta.recording_audio_path = Some(value);
                }
            }
            "handwriting_attachment_path" => {
                if !value.is_empty() {
                    meta.handwriting_attachment_path = Some(value);
                }
            }
            "transcription_status" => {
                if !value.is_empty() {
                    meta.transcription_status = Some(value);
                }
            }
            "transcription_error" => {
                if !value.is_empty() {
                    meta.transcription_error = Some(value);
                }
            }
            "transcription_updated_ms" => {
                if let Ok(parsed) = value.parse::<i64>() {
                    meta.transcription_updated_ms = Some(parsed);
                } else {
                    meta.passthrough_lines.push(trimmed.to_string());
                }
            }
            "transcription_id" => {
                if !value.is_empty() {
                    meta.transcription_id = Some(value);
                }
            }
            "ocr_status" => {
                if !value.is_empty() {
                    meta.ocr_status = Some(value);
                }
            }
            "ocr_error" => {
                if !value.is_empty() {
                    meta.ocr_error = Some(value);
                }
            }
            "ocr_updated_ms" => {
                if let Ok(parsed) = value.parse::<i64>() {
                    meta.ocr_updated_ms = Some(parsed);
                } else {
                    meta.passthrough_lines.push(trimmed.to_string());
                }
            }
            "imported_from_apple_notes" => {
                if let Ok(parsed) = value.parse::<bool>() {
                    meta.imported_from_apple_notes = Some(parsed);
                } else {
                    meta.passthrough_lines.push(trimmed.to_string());
                }
            }
            _ => meta.passthrough_lines.push(trimmed.to_string()),
        }
    }

    (meta, body.to_string())
}

/// Escape a front-matter value if it contains special characters.
fn front_matter_safe_value(value: &str) -> String {
    if value
        .chars()
        .all(|char| char.is_ascii_alphanumeric() || matches!(char, '-' | '_' | '.'))
    {
        value.to_string()
    } else {
        format!("{:?}", value)
    }
}

/// Serialize front-matter + body back into a markdown string.
pub fn render_note_with_front_matter(meta: &NoteFrontMatter, body: &str) -> String {
    let mut output = String::new();
    output.push_str("---\n");
    if let Some(tags) = &meta.tags {
        output.push_str(&format!("tags: {}\n", serde_json::to_string(tags).expect("string list")));
    }
    if let Some(id) = &meta.id {
        output.push_str(&format!("id: {}\n", front_matter_safe_value(id)));
    }
    if let Some(created_ms) = meta.created_ms {
        output.push_str(&format!("created_ms: {}\n", created_ms));
    }
    if let Some(updated_ms) = meta.updated_ms {
        output.push_str(&format!("updated_ms: {}\n", updated_ms));
    }
    if let Some(note_type) = &meta.note_type {
        output.push_str(&format!("type: {}\n", front_matter_safe_value(note_type)));
    }
    if let Some(archived_ms) = meta.archived_ms {
        output.push_str(&format!("archived_ms: {}\n", archived_ms));
    }
    if let Some(reviewed_ms) = meta.reviewed_ms {
        output.push_str(&format!("reviewed_ms: {}\n", reviewed_ms));
    }
    if let Some(audio_path) = &meta.recording_audio_path {
        output.push_str(&format!(
            "recording_audio_path: {}\n",
            front_matter_safe_value(audio_path)
        ));
    }
    if let Some(attachment_path) = &meta.handwriting_attachment_path {
        output.push_str(&format!(
            "handwriting_attachment_path: {}\n",
            front_matter_safe_value(attachment_path)
        ));
    }
    if let Some(status) = &meta.transcription_status {
        output.push_str(&format!(
            "transcription_status: {}\n",
            front_matter_safe_value(status)
        ));
    }
    if let Some(error) = &meta.transcription_error {
        output.push_str(&format!(
            "transcription_error: {}\n",
            front_matter_safe_value(error)
        ));
    }
    if let Some(updated_ms) = meta.transcription_updated_ms {
        output.push_str(&format!("transcription_updated_ms: {}\n", updated_ms));
    }
    if let Some(transcription_id) = &meta.transcription_id {
        output.push_str(&format!(
            "transcription_id: {}\n",
            front_matter_safe_value(transcription_id)
        ));
    }
    if let Some(status) = &meta.ocr_status {
        output.push_str(&format!(
            "ocr_status: {}\n",
            front_matter_safe_value(status)
        ));
    }
    if let Some(error) = &meta.ocr_error {
        output.push_str(&format!("ocr_error: {}\n", front_matter_safe_value(error)));
    }
    if let Some(updated_ms) = meta.ocr_updated_ms {
        output.push_str(&format!("ocr_updated_ms: {}\n", updated_ms));
    }
    if let Some(imported_from_apple_notes) = meta.imported_from_apple_notes {
        output.push_str(&format!(
            "imported_from_apple_notes: {}\n",
            imported_from_apple_notes
        ));
    }
    for line in &meta.passthrough_lines {
        output.push_str(line);
        output.push('\n');
    }
    output.push_str("---\n\n");
    output.push_str(body);
    output
}

/// Write a note to disk, encrypting the body if security is enabled.
pub fn write_note_with_front_matter(
    path: &Path,
    meta: &NoteFrontMatter,
    body: &str,
) -> Result<(), String> {
    let body_to_write = encrypt_note_body_for_write(body)?;
    let serialized = render_note_with_front_matter(meta, &body_to_write);
    fs::write(path, serialized).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_front_matter_emits_only_set_fields() {
        let meta = NoteFrontMatter {
            id: Some("abc".to_string()),
            created_ms: Some(1_700_000_000_000),
            note_type: Some("recording".to_string()),
            ..Default::default()
        };
        let rendered = render_note_with_front_matter(&meta, "Hello body");
        assert!(rendered.starts_with("---\n"));
        assert!(rendered.contains("id: abc"));
        assert!(rendered.contains("created_ms: 1700000000000"));
        assert!(rendered.contains("type: recording"));
        // updated_ms was None, so it must not be serialized.
        assert!(!rendered.contains("updated_ms:"));
        assert!(rendered.ends_with("Hello body"));
    }

    #[test]
    fn front_matter_round_trips_through_parse() {
        let meta = NoteFrontMatter {
            id: Some("note-1".to_string()),
            created_ms: Some(42),
            note_type: Some("recording".to_string()),
            archived_ms: Some(77),
            reviewed_ms: Some(88),
            ..Default::default()
        };
        let rendered = render_note_with_front_matter(&meta, "Body text");
        let (parsed, body) = parse_note_front_matter(&rendered);
        assert_eq!(parsed.id.as_deref(), Some("note-1"));
        assert_eq!(parsed.created_ms, Some(42));
        assert_eq!(parsed.note_type.as_deref(), Some("recording"));
        assert_eq!(parsed.archived_ms, Some(77));
        assert_eq!(parsed.reviewed_ms, Some(88));
        // Exact, not trimmed: a trimmed assertion hid the separator newline
        // that parse used to hand back as content.
        assert_eq!(body, "Body text");
    }

    #[test]
    fn parse_is_the_inverse_of_render_across_repeated_round_trips() {
        let meta = NoteFrontMatter {
            id: Some("note-1".to_string()),
            created_ms: Some(42),
            ..Default::default()
        };
        // Reading a note and writing it back must be a fixed point. It was not:
        // each pass prepended a blank line, so the note's first line kept
        // sliding down every time the phone reconciled its capture draft.
        let mut body = "First line\nsecond line".to_string();
        for _ in 0..3 {
            let (_, parsed) = parse_note_front_matter(&render_note_with_front_matter(&meta, &body));
            body = parsed;
            assert_eq!(body, "First line\nsecond line");
        }
    }

    #[test]
    fn parse_keeps_a_deliberately_blank_first_body_line() {
        let meta = NoteFrontMatter { id: Some("n".to_string()), ..Default::default() };
        // Only the one separator newline is structural; a second blank line is
        // the user's and must survive.
        let (_, body) = parse_note_front_matter(&render_note_with_front_matter(&meta, "\nIndented start"));
        assert_eq!(body, "\nIndented start");
    }
}

#[cfg(test)]
mod tag_tests {
    use super::*;
    #[test]
    fn note_tags_round_trip() {
        let (meta, _) = parse_note_front_matter("---\ntags: [todo, urgent, работа]\n---\nbody");
        assert_eq!(meta.tags.as_ref().unwrap(), &vec!["todo", "urgent", "работа"]);
        let rendered = render_note_with_front_matter(&meta, "body");
        assert_eq!(parse_note_front_matter(&rendered).0.tags, meta.tags);
    }
}

/// Header-only writes must not add separator blank lines or re-encrypt the body.
pub(super) fn write_note_metadata(path: &Path, meta: &NoteFrontMatter) -> Result<(), String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let body = [("---\n", "\n---\n"), ("---\r\n", "\r\n---\r\n")].iter()
        .find_map(|(opening, closing)| raw.strip_prefix(opening).and_then(|rest| {
            rest.find(closing).map(|index| &rest[index + closing.len()..])
        })).unwrap_or(&raw);
    let mut header = render_note_with_front_matter(meta, "");
    header.pop(); // renderer's extra blank separator already belongs to the persisted body
    header.push_str(body);
    fs::write(path, header).map_err(|e| e.to_string())
}
