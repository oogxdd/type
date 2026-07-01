//! Note IDs, content slugs, and unique filename allocation.

use std::path::Path;

use time::{macros::format_description, Duration as TimeDuration, OffsetDateTime};
use uuid::Uuid;

use super::NoteFileNameFormat;

/// Generate a new UUIDv7-based note identifier.
pub fn generate_note_id() -> String {
    Uuid::now_v7().to_string()
}

/// Extract the trailing portion of a UUID (after the timestamp segments).
pub fn uuid_tail_without_timestamp_prefix(note_id: &str) -> String {
    let parts = note_id.split('-').collect::<Vec<_>>();
    if parts.len() >= 5 {
        return parts[2..].join("-").to_lowercase();
    }
    note_id.to_lowercase()
}

fn uuid_prefix_with_timestamp(note_id: &str) -> String {
    let lower = note_id.to_lowercase();
    lower.chars().take(13).collect()
}

fn utc_note_filename_timestamp(timestamp_ms: i64) -> String {
    let seconds = timestamp_ms.div_euclid(1_000);
    let millis = timestamp_ms.rem_euclid(1_000);
    let nanos = millis.saturating_mul(1_000_000);
    let base = OffsetDateTime::from_unix_timestamp(seconds).unwrap_or(OffsetDateTime::UNIX_EPOCH);
    let value = base + TimeDuration::nanoseconds(nanos);
    value
        .format(&format_description!(
            "[year]-[month]-[day]T[hour]-[minute]-[second]Z"
        ))
        .unwrap_or_else(|_| "1970-01-01T00-00-00Z".to_string())
}

fn is_noise_hash_token(value: &str) -> bool {
    !value.is_empty() && value.len() <= 32 && value.chars().all(|ch| ch.is_ascii_alphanumeric())
}

fn slug_content_char_count(value: &str) -> usize {
    value.chars().filter(|ch| *ch != '-').count()
}

/// Derive a short kebab-case slug from the note body for the filename.
pub fn slug_from_content(content: &str, fallback: &str) -> String {
    const MAX_SLUG_WORDS: usize = 8;
    const MAX_SLUG_CHARS: usize = 56;
    const MIN_SLUG_CONTENT_CHARS: usize = 8;

    let mut normalized = String::with_capacity(content.len().saturating_mul(2));
    for ch in content.chars() {
        if ch.is_alphanumeric() || ch == '-' || ch == '_' || ch.is_whitespace() {
            for lower in ch.to_lowercase() {
                normalized.push(lower);
            }
        } else {
            normalized.push(' ');
        }
    }

    let tokens: Vec<&str> = normalized
        .split(|ch: char| ch.is_whitespace() || ch == '-' || ch == '_')
        .filter(|token| !token.is_empty())
        .collect();

    let mut words = Vec::new();
    let mut index = 0usize;
    while index < tokens.len() && words.len() < MAX_SLUG_WORDS {
        if index + 3 < tokens.len()
            && tokens[index] == "nv"
            && tokens[index + 1] == "empty"
            && tokens[index + 2] == "line"
            && tokens[index + 3] == "token"
        {
            index += 4;
            if index < tokens.len() && is_noise_hash_token(tokens[index]) {
                index += 1;
            }
            continue;
        }

        let token = tokens[index];
        index += 1;
        if token.starts_with("http") || token.starts_with("www") {
            continue;
        }
        words.push(token.to_string());
    }

    let mut slug = if words.is_empty() {
        fallback.to_string()
    } else {
        words.join("-")
    };

    if slug.chars().count() > MAX_SLUG_CHARS {
        slug = slug.chars().take(MAX_SLUG_CHARS).collect();
    }

    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() || slug_content_char_count(&slug) < MIN_SLUG_CONTENT_CHARS {
        fallback.to_string()
    } else {
        slug
    }
}

/// Find an available filename with the given prefix and slug, appending a counter on collision.
pub fn allocate_prefixed_note_file_name(
    folder: &Path,
    prefix: &str,
    slug: &str,
) -> Result<String, String> {
    for attempt in 0..=512usize {
        let candidate = if attempt == 0 {
            format!("{}-{}.md", prefix, slug)
        } else {
            format!("{}-{}-{}.md", prefix, slug, attempt)
        };
        if !folder.join(&candidate).exists() {
            return Ok(candidate);
        }
    }
    Err("Failed to allocate note filename.".to_string())
}

/// Find an available filename using the full UUIDv7 as base name.
pub fn allocate_uuid_v7_note_file_name(
    folder: &Path,
    note_id: &str,
) -> Result<String, String> {
    let base = note_id.to_lowercase();
    for attempt in 0..=512usize {
        let candidate = if attempt == 0 {
            format!("{}.md", base)
        } else {
            format!("{}-{}.md", base, attempt)
        };
        if !folder.join(&candidate).exists() {
            return Ok(candidate);
        }
    }
    Err("Failed to allocate note filename.".to_string())
}

/// Allocate a unique filename for a new note using the chosen format strategy.
pub fn allocate_note_file_name(
    folder: &Path,
    timestamp_ms: i64,
    note_id: &str,
    content: &str,
    fallback_slug: &str,
    file_name_format: NoteFileNameFormat,
) -> Result<String, String> {
    match file_name_format {
        NoteFileNameFormat::UtcTimestampSlug => {
            let prefix = utc_note_filename_timestamp(timestamp_ms);
            let slug = slug_from_content(content, fallback_slug);
            allocate_prefixed_note_file_name(folder, &prefix, &slug)
        }
        NoteFileNameFormat::UuidV7 => allocate_uuid_v7_note_file_name(folder, note_id),
        NoteFileNameFormat::UuidV7PrefixSlug => {
            let prefix = uuid_prefix_with_timestamp(note_id);
            let slug = slug_from_content(content, fallback_slug);
            allocate_prefixed_note_file_name(folder, &prefix, &slug)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::note_parent_folder_path;

    #[test]
    fn slug_from_content_basic_kebab() {
        assert_eq!(slug_from_content("Hello World", "fallback"), "hello-world");
    }

    #[test]
    fn slug_from_content_is_unicode_aware() {
        // Cyrillic letters are alphanumeric and must survive slugging.
        assert_eq!(
            slug_from_content("Привет мир друзья", "fallback"),
            "привет-мир-друзья"
        );
    }

    #[test]
    fn slug_from_content_falls_back_when_too_short() {
        // "hi" is below the minimum content-char threshold, so the fallback wins.
        assert_eq!(slug_from_content("Hi", "2024-note"), "2024-note");
    }

    #[test]
    fn slug_from_content_strips_empty_line_token_noise() {
        // The NV_EMPTY_LINE_TOKEN marker and its trailing hash are dropped.
        assert_eq!(
            slug_from_content("nv empty line token a1b2c3d4 hello world friend", "fb"),
            "hello-world-friend"
        );
    }

    #[test]
    fn slug_from_content_truncates_to_max_chars() {
        let slug = slug_from_content(&"a".repeat(100), "fb");
        assert_eq!(slug.chars().count(), 56);
    }

    #[test]
    fn note_parent_folder_path_extracts_parent() {
        assert_eq!(note_parent_folder_path("Feed/note.md"), "Feed");
        assert_eq!(note_parent_folder_path("a/b/c.md"), "a/b");
        assert_eq!(note_parent_folder_path("note.md"), "");
    }
}
