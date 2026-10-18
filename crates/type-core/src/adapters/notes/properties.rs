//! User note properties: plain `key: value` frontmatter lines the core does not
//! own. A flag is a property whose value is `true`; an enum-like property
//! (`status: done`) is the same line with another value. They live in
//! `NoteFrontMatter::passthrough_lines`, so other shells preserve them unread.

use std::collections::BTreeMap;

/// Keys the core parses itself (see `parse_note_front_matter`). Properties
/// must never shadow them.
const RESERVED_KEYS: &[&str] = &[
    "tags",
    "id",
    "created_ms",
    "updated_ms",
    "type",
    "archived_ms",
    "reviewed_ms",
    "recording_audio_path",
    "handwriting_attachment_path",
    "transcription_status",
    "transcription_error",
    "transcription_updated_ms",
    "transcription_id",
    "ocr_status",
    "ocr_error",
    "ocr_updated_ms",
    "imported_from_apple_notes",
];

pub const FLAG_VALUE: &str = "true";

pub fn valid_property_key(key: &str) -> bool {
    key.len() <= 64
        && key.chars().next().is_some_and(|c| c.is_ascii_lowercase())
        && key
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '-'))
        && !RESERVED_KEYS.contains(&key)
}

/// Values stay unquoted YAML scalars so every reader agrees on them.
pub fn valid_property_value(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

fn split(line: &str) -> Option<(String, &str)> {
    let (key, value) = line.split_once(':')?;
    let key = key.trim().to_lowercase();
    valid_property_key(&key).then_some((key, value.trim().trim_matches('"').trim_matches('\'')))
}

/// Properties found in passthrough lines. Malformed lines are not properties
/// but stay preserved in the note.
pub fn note_properties(passthrough_lines: &[String]) -> BTreeMap<String, String> {
    passthrough_lines
        .iter()
        .filter_map(|line| split(line))
        .filter(|(_, value)| valid_property_value(value))
        .map(|(key, value)| (key, value.to_string()))
        .collect()
}

/// Replaces every line for `key`; `None` removes the property.
pub fn set_property_line(
    passthrough_lines: &mut Vec<String>,
    key: &str,
    value: Option<&str>,
) -> Result<(), String> {
    if !valid_property_key(key) {
        return Err(format!("“{key}” cannot be used as a property name."));
    }
    if value.is_some_and(|value| !valid_property_value(value)) {
        return Err("Property values use letters, digits, '-', '_' or '.'.".into());
    }
    passthrough_lines.retain(|line| split(line).is_none_or(|(k, _)| k != key));
    if let Some(value) = value {
        passthrough_lines.push(format!("{key}: {value}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_and_enum_values_round_trip_without_touching_other_lines() {
        let mut lines = vec![
            "custom: \"keep me\"".to_string(),
            "Status: postponed".into(),
            "status: done".into(),
            "broken line".into(),
        ];
        set_property_line(&mut lines, "status", Some("in-progress")).unwrap();
        set_property_line(&mut lines, "reflection", Some(FLAG_VALUE)).unwrap();
        assert_eq!(
            lines,
            [
                "custom: \"keep me\"",
                "broken line",
                "status: in-progress",
                "reflection: true"
            ]
        );
        let props = note_properties(&lines);
        assert_eq!(props["reflection"], "true");
        assert_eq!(props["status"], "in-progress");
        assert!(!props.contains_key("custom")); // not a plain scalar value
        set_property_line(&mut lines, "reflection", None).unwrap();
        assert!(!note_properties(&lines).contains_key("reflection"));
        assert!(set_property_line(&mut lines, "archived_ms", Some("1")).is_err());
        assert!(set_property_line(&mut lines, "Status", Some("x")).is_err());
        assert!(set_property_line(&mut lines, "status", Some("two words")).is_err());
    }
}
