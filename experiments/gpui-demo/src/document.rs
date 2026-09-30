use std::ops::Range;

/// Keep frontmatter verbatim. This demo does not interpret or rewrite YAML.
pub fn split_frontmatter(source: &str) -> (String, String) {
    let Some(first_end) = source.find('\n') else {
        return (String::new(), source.into());
    };
    if source[..first_end].trim_end_matches('\r') != "---" {
        return (String::new(), source.into());
    }
    let mut offset = first_end + 1;
    for line in source[offset..].split_inclusive('\n') {
        offset += line.len();
        if line.trim_end_matches(['\r', '\n']) == "---" {
            return (source[..offset].into(), source[offset..].into());
        }
    }
    (String::new(), source.into())
}

#[derive(Debug, PartialEq, Eq)]
pub struct TagRegion {
    pub range: Range<usize>,
    pub marker: Range<usize>,
    pub tag: String,
}

/// Deliberately small, presentation-only subset of Type's tag syntax.
/// This is not a privacy filter or the production Markdown parser.
pub fn tag_regions(text: &str) -> Vec<TagRegion> {
    let mut regions = Vec::new();
    let mut stack: Vec<(usize, usize, usize, String)> = Vec::new();
    let mut paragraph: Option<TagRegion> = None;
    let mut code_fence: Option<(char, usize)> = None;
    let mut offset = 0;
    for raw in text.split_inclusive('\n') {
        let line = raw.trim_end_matches(['\r', '\n']);
        let trimmed = line.trim_start();
        let first = trimmed.chars().next();
        if matches!(first, Some('`' | '~')) {
            let ch = first.unwrap();
            let count = trimmed.chars().take_while(|c| *c == ch).count();
            if count >= 3 {
                match code_fence {
                    Some((open, size)) if open == ch && count >= size => code_fence = None,
                    None => code_fence = Some((ch, count)),
                    _ => {}
                }
                if let Some(region) = paragraph.take() {
                    regions.push(region);
                }
                offset += raw.len();
                continue;
            }
        }
        if code_fence.is_some() || line.starts_with("    ") || line.starts_with('\t') {
            if let Some(region) = paragraph.take() {
                regions.push(region);
            }
            offset += raw.len();
            continue;
        }
        let fence_len = line.chars().take_while(|c| *c == ':').count();
        if fence_len >= 3 {
            if let Some(region) = paragraph.take() {
                regions.push(region);
            }
            let attrs = line[fence_len..].trim();
            if attrs.is_empty() {
                if stack.last().is_some_and(|entry| entry.2 == fence_len) {
                    let (start, marker_end, _, tag) = stack.pop().unwrap();
                    regions.push(TagRegion {
                        range: start..offset + line.len(),
                        marker: start..marker_end,
                        tag,
                    });
                }
            } else if let Some((tag, _)) = leading_tags(attrs) {
                // The demo recognizes hashtag attributes; production also supports flags.
                if attrs.split_whitespace().all(|word| valid_tag(word)) {
                    stack.push((offset, offset + line.len(), fence_len, tag));
                }
            }
        } else if line.trim().is_empty() {
            if let Some(region) = paragraph.take() {
                regions.push(region);
            }
        } else if paragraph.is_some() {
            paragraph.as_mut().unwrap().range.end = offset + line.len();
        } else if let Some((tag, marker_len)) = leading_tags(line) {
            if !line[marker_len..].trim().is_empty() {
                paragraph = Some(TagRegion {
                    range: offset..offset + line.len(),
                    marker: offset..offset + marker_len,
                    tag,
                });
            }
        }
        offset += raw.len();
    }
    if let Some(region) = paragraph {
        regions.push(region);
    }
    for (start, marker_end, _, tag) in stack {
        regions.push(TagRegion {
            range: start..text.len(),
            marker: start..marker_end,
            tag,
        });
    }
    regions
}

fn valid_tag(word: &str) -> bool {
    let Some(name) = word.strip_prefix('#') else {
        return false;
    };
    !name.is_empty()
        && name.chars().count() <= 80
        && name.chars().next().is_some_and(char::is_alphanumeric)
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || "_./-".contains(c))
}

fn leading_tags(line: &str) -> Option<(String, usize)> {
    if !line.starts_with('#') {
        return None;
    }
    let mut end = 0;
    let mut first = None;
    for word in line.split_whitespace() {
        if !valid_tag(word) {
            break;
        }
        first.get_or_insert_with(|| word.into());
        end += word.len();
        while line
            .as_bytes()
            .get(end)
            .is_some_and(|byte| matches!(byte, b' ' | b'\t'))
        {
            end += 1;
        }
    }
    first.map(|tag| (tag, end))
}

pub fn whole_lines(text: &str, selection: Range<usize>) -> Range<usize> {
    let start = text[..selection.start]
        .rfind('\n')
        .map_or(0, |index| index + 1);
    let last = if selection.end > selection.start && text[..selection.end].ends_with('\n') {
        selection.end - 1
    } else {
        selection.end
    };
    let end = text[last..]
        .find('\n')
        .map_or(text.len(), |index| last + index);
    start..end
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_round_trip_preserves_unknown_fields_and_crlf() {
        let source = "---\r\nid: demo\r\nunknown: 'keep this'\r\n---\r\nПривет\n";
        let (header, body) = split_frontmatter(source);
        assert_eq!(body, "Привет\n");
        assert_eq!(format!("{header}{body}"), source);
        assert_eq!(split_frontmatter("---\nunclosed\ntext").0, "");
    }

    #[test]
    fn tags_cover_paragraphs_nested_scopes_and_unterminated_containers() {
        let text = "#todo Первая строка\nпродолжение\n\n:::: #work\n::: #idea\nстрока\nещё\n:::\n::::\n::: #open\nхвост";
        let regions = tag_regions(text);
        assert_eq!(regions.len(), 4);
        assert_eq!(
            &text[regions[0].range.clone()],
            "#todo Первая строка\nпродолжение"
        );
        assert!(
            regions
                .iter()
                .any(|region| region.tag == "#idea" && text[region.range.clone()].contains("ещё"))
        );
        assert_eq!(regions.last().unwrap().range.end, text.len());
    }

    #[test]
    fn mid_line_hashtags_code_and_hashtag_only_lines_are_plain_text() {
        assert!(
            tag_regions("Prose #todo text\n\n#todo #idea\n\n```\n#todo code\n::: #idea\n```\n")
                .is_empty()
        );
    }

    #[test]
    fn whole_line_selection_does_not_include_next_line_when_ending_at_its_start() {
        assert_eq!(whole_lines("one\ntwo\nthree", 0..4), 0..3);
        assert_eq!(whole_lines("one\ntwo\nthree", 5..9), 4..13);
    }
}
