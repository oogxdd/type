//! Compact list text. Keep behavior aligned with shared/format.ts and tags.ts;
//! the cross-language fixtures pin Markdown, tag and attachment semantics.
use super::notes::NoteMeta;
use regex::Regex;
use std::sync::LazyLock;

pub const PREVIEW_LINE_CHARS: usize = 384;

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("preview regex")
}
static TOKEN: LazyLock<Regex> = LazyLock::new(|| {
    re(
        r##"^(?:#([\p{L}\p{N}](?:[\p{L}\p{N}_./-]|\\_)*)|[A-Za-z_][A-Za-z0-9_-]*=(?:"(?:[^"\\]|\\.)*"|[^"\s}][^\s}]*))"##,
    )
});
static LEADING: LazyLock<Regex> =
    LazyLock::new(|| re(r"^#([\p{L}\p{N}](?:[\p{L}\p{N}_./-]|\\_)*)[ \t]+"));
static ANNOTATION: LazyLock<Regex> =
    LazyLock::new(|| re(r"^type_annotations_b64:\s*[A-Za-z0-9+/=]{16,}\s*$"));
static LENS: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?s)(?:\n{1,2})?<!--\s*type:lens:v1\s*\n.*?\n-->\s*$"));
static FRONTMATTER: LazyLock<Regex> = LazyLock::new(|| re(r"(?s)^---\n(.*?)\n---\n?"));
static FIELD: LazyLock<Regex> = LazyLock::new(|| re(r"(?m)^\s*[A-Za-z0-9_-]+\s*:\s*"));
static ESCAPED_BRACKET: LazyLock<Regex> = LazyLock::new(|| re(r"\\([\[\]])"));
static ESCAPED_UNDERSCORE: LazyLock<Regex> = LazyLock::new(|| re(r"\\+_"));
static EMPTY_TOKEN: LazyLock<Regex> = LazyLock::new(|| {
    re(
        r"(?i)NV_EMPTY_LINE_TOKEN_[A-Za-z0-9]+|NV[\s_]+EMPTY[\s_]+LINE[\s_]+TOKEN(?:[\s_]+[A-Za-z0-9]+)?",
    )
});
static HEADING: LazyLock<Regex> = LazyLock::new(|| re(r"^#{1,6}\s+"));
static LIST: LazyLock<Regex> = LazyLock::new(|| re(r"^[>\-+*]\s+"));
static IMAGE: LazyLock<Regex> = LazyLock::new(|| re(r"!\[([^\]]*)\]\([^)]+\)"));
static LINK: LazyLock<Regex> = LazyLock::new(|| re(r"\[([^\]]+)\]\([^)]+\)"));
static SPACE: LazyLock<Regex> = LazyLock::new(|| re(r"\s+"));
static NOISE: LazyLock<Regex> = LazyLock::new(|| {
    re(
        r"(?i)^(?:recording$|transcript$|<!--\s*recording-transcript:(?:start|end)\s*-->$|\(transcription(?:\s+[A-Za-z0-9_]+)*\.\)$|error:)",
    )
});

fn valid_attrs(mut text: &str) -> bool {
    text = text.trim();
    if text.is_empty() {
        return false;
    }
    while !text.is_empty() {
        let Some(caps) = TOKEN.captures(text) else {
            return false;
        };
        if caps
            .get(1)
            .is_some_and(|m| m.as_str().replace("\\_", "_").chars().count() > 80)
        {
            return false;
        }
        text = &text[caps.get(0).unwrap().end()..];
        if !text.is_empty() && !text.starts_with(char::is_whitespace) {
            return false;
        }
        text = text.trim_start();
    }
    true
}

fn strip_spans(source: &str) -> String {
    let mut result = String::new();
    let mut rest = source;
    while !rest.is_empty() {
        let mut consumed = false;
        if rest.starts_with('[') {
            let mut depth = 1;
            let mut escaped = false;
            let mut end = None;
            for (i, ch) in rest.char_indices().skip(1) {
                if escaped {
                    escaped = false;
                    continue;
                }
                if ch == '\\' {
                    escaped = true;
                    continue;
                }
                if ch == '[' {
                    depth += 1;
                }
                if ch == ']' {
                    depth -= 1;
                }
                if depth == 0 {
                    end = Some(i);
                    break;
                }
            }
            if let Some(end) = end.filter(|i| rest[*i + 1..].starts_with('{')) {
                let mut quoted = false;
                let mut escaped = false;
                for (i, ch) in rest.char_indices().filter(|(i, _)| *i > end + 1) {
                    if escaped {
                        escaped = false;
                        continue;
                    }
                    if ch == '\\' {
                        escaped = true;
                        continue;
                    }
                    if ch == '"' {
                        quoted = !quoted;
                    }
                    if ch == '}' && !quoted {
                        if valid_attrs(&rest[end + 2..i]) {
                            result.push_str(&strip_spans(&rest[1..end]));
                            rest = &rest[i + 1..];
                            consumed = true;
                        }
                        break;
                    }
                }
                // A consumed span advances rest. Otherwise copy its opening bracket.
                if consumed {
                    continue;
                }
            }
        }
        let ch = rest.chars().next().unwrap();
        result.push(ch);
        rest = &rest[ch.len_utf8()..];
    }
    result
}

fn strip_line(line: &str) -> Option<String> {
    if line.starts_with(":::") {
        let tail = line.trim_start_matches(':').trim();
        if tail.is_empty() || valid_attrs(tail) {
            return None;
        }
    }
    let unescaped = ESCAPED_BRACKET.replace_all(line, "$1");
    let spanless = strip_spans(&unescaped);
    let mut rest = spanless.as_str();
    let mut count = 0;
    let mut valid = true;
    while let Some(caps) = LEADING.captures(rest) {
        if caps[1].replace("\\_", "_").chars().count() > 80 {
            valid = false;
            break;
        }
        rest = &rest[caps.get(0).unwrap().end()..];
        count += 1;
    }
    let source = if valid
        && count > 0
        && !rest.trim().is_empty()
        && !(rest.starts_with('#') && valid_attrs(rest))
    {
        rest
    } else {
        &spanless
    };
    let value = ESCAPED_UNDERSCORE.replace_all(source, "_");
    let value = EMPTY_TOKEN.replace_all(&value, " ");
    let value = HEADING.replace(&value, "");
    let value = LIST.replace(&value, "");
    let value = IMAGE.replace_all(&value, "$1");
    let value = LINK.replace_all(&value, "$1");
    let value: String = value
        .chars()
        .filter(|ch| !matches!(ch, '*' | '_' | '~' | '`'))
        .collect();
    Some(SPACE.replace_all(&value, " ").trim().to_string())
}

pub fn preview_lines(body: &str, meta: &NoteMeta) -> (String, String) {
    let normalized = body.replace("\r\n", "\n");
    let body = if let Some(caps) = FRONTMATTER.captures(&normalized) {
        if caps[1].trim().is_empty() || FIELD.is_match(&caps[1]) {
            &normalized[caps.get(0).unwrap().end()..]
        } else {
            &normalized
        }
    } else {
        &normalized
    };
    let body = LENS.replace(body, "");
    let mut lines = body
        .lines()
        .filter(|line| !ANNOTATION.is_match(line.trim()))
        .filter_map(strip_line)
        .filter(|line| !line.is_empty() && !NOISE.is_match(line));
    let first = lines.next();
    let second = lines.next().unwrap_or_default();
    let recording = meta.note_type.as_deref() == Some("audio_recording")
        || meta
            .recording_audio_path
            .as_ref()
            .is_some_and(|p| !p.trim().is_empty());
    let handwriting = meta.note_type.as_deref() == Some("handwriting_attachment")
        || meta
            .handwriting_attachment_path
            .as_ref()
            .is_some_and(|p| !p.trim().is_empty());
    let title = first.unwrap_or_else(|| {
        if recording
            && meta
                .transcription_status
                .as_deref()
                .unwrap_or("")
                .trim()
                .to_lowercase()
                != "completed"
        {
            "Voice recording".into()
        } else if handwriting
            && meta
                .ocr_status
                .as_deref()
                .unwrap_or("")
                .trim()
                .to_lowercase()
                != "completed"
        {
            "Handwriting note".into()
        } else {
            String::new()
        }
    });
    (
        title.chars().take(PREVIEW_LINE_CHARS).collect(),
        second.chars().take(PREVIEW_LINE_CHARS).collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_typescript_contract() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/shared/test-fixtures/note-previews.json"
        ))
        .unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let meta: NoteMeta = serde_json::from_value(fixture["meta"].clone()).unwrap();
            let actual = preview_lines(fixture["body"].as_str().unwrap(), &meta);
            assert_eq!(
                actual.0,
                fixture["title"].as_str().unwrap(),
                "{}",
                fixture["body"]
            );
            assert_eq!(
                actual.1,
                fixture["secondLine"].as_str().unwrap(),
                "{}",
                fixture["body"]
            );
        }
    }

    #[test]
    fn long_unicode_lines_are_bounded_without_splitting_characters() {
        let meta = serde_json::from_str("{}").unwrap();
        let body = format!(
            "{}\n{}\n{}",
            "🦀".repeat(10_000),
            "я".repeat(10_000),
            "unused".repeat(100_000)
        );
        let (title, second) = preview_lines(&body, &meta);
        assert_eq!(title.chars().count(), PREVIEW_LINE_CHARS);
        assert_eq!(second.chars().count(), PREVIEW_LINE_CHARS);
        assert!(title.chars().all(|ch| ch == '🦀'));
    }
}
