//! Front-matter: parse and render the YAML-ish header stored on each note.

use std::{fs, path::Path};

use crate::encrypt_note_body_for_write;

use super::NoteFrontMatter;

/// Parse `---` delimited YAML-ish front-matter from a raw markdown string.
pub(crate) fn parse_note_front_matter(raw: &str) -> (NoteFrontMatter, String) {
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
    let body = &normalized[(header_end + 5)..];

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
pub(crate) fn render_note_with_front_matter(meta: &NoteFrontMatter, body: &str) -> String {
    let mut output = String::new();
    output.push_str("---\n");
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
    for line in &meta.passthrough_lines {
        output.push_str(line);
        output.push('\n');
    }
    output.push_str("---\n\n");
    output.push_str(body);
    output
}

/// Write a note to disk, encrypting the body if security is enabled.
pub(crate) fn write_note_with_front_matter(
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
            ..Default::default()
        };
        let rendered = render_note_with_front_matter(&meta, "Body text");
        let (parsed, body) = parse_note_front_matter(&rendered);
        assert_eq!(parsed.id.as_deref(), Some("note-1"));
        assert_eq!(parsed.created_ms, Some(42));
        assert_eq!(parsed.note_type.as_deref(), Some("recording"));
        assert_eq!(body.trim(), "Body text");
    }
}
