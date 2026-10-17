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

/// A line holding exactly one Markdown image, e.g. `![alt](/path.png)`.
#[derive(Debug, PartialEq, Eq)]
pub struct ImageLine {
    /// Byte range of the line without its newline.
    pub line: Range<usize>,
    pub target: String,
}

/// Image-only lines outside fenced code. The editor previews these in place
/// of their Markdown source; mid-line images stay ordinary text.
pub fn image_lines(text: &str) -> Vec<ImageLine> {
    let mut lines = Vec::new();
    let mut code_fence: Option<(char, usize)> = None;
    let mut offset = 0;
    for raw in text.split_inclusive('\n') {
        let line = raw.trim_end_matches(['\r', '\n']);
        let trimmed = line.trim();
        let first = trimmed.chars().next();
        if let Some(ch @ ('`' | '~')) = first {
            let count = trimmed.chars().take_while(|c| *c == ch).count();
            if count >= 3 {
                match code_fence {
                    Some((open, size)) if open == ch && count >= size => code_fence = None,
                    None => code_fence = Some((ch, count)),
                    _ => {}
                }
            }
        } else if code_fence.is_none() {
            if let Some(target) = image_target(trimmed) {
                lines.push(ImageLine {
                    line: offset..offset + line.len(),
                    target: target.into(),
                });
            }
        }
        offset += raw.len();
    }
    lines
}

fn image_target(line: &str) -> Option<&str> {
    let rest = line.strip_prefix("![")?;
    let close = rest.find("](")?;
    let inner = rest[close + 2..].strip_suffix(')')?;
    let inner = inner.trim();
    // `<...>` destinations may contain spaces; an optional title follows.
    let target = if let Some(rest) = inner.strip_prefix('<') {
        let (target, title) = rest.split_once('>')?;
        if !title.is_empty() && !title.trim_start().starts_with('"') {
            return None;
        }
        target
    } else {
        match inner.split_once(char::is_whitespace) {
            Some((target, title)) if title.trim_start().starts_with('"') => target,
            Some(_) => return None,
            None => inner,
        }
    };
    (!target.is_empty() && !target.contains(['(', ')'])).then_some(target)
}

/// Markdown that puts each image link on its own line at `offset`.
/// Returns the text to insert and the cursor offset within it.
pub fn image_insertion(text: &str, offset: usize, targets: &[String]) -> (String, usize) {
    let links = targets
        .iter()
        .map(|target| format!("![]({target})"))
        .collect::<Vec<_>>()
        .join("\n");
    let before = &text[..offset];
    let prefix = if before.is_empty() || before.ends_with('\n') {
        ""
    } else {
        "\n"
    };
    let cursor = prefix.len() + links.len();
    let suffix = if text[offset..].starts_with('\n') {
        ""
    } else {
        "\n"
    };
    (format!("{prefix}{links}{suffix}"), cursor)
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

    #[test]
    fn image_lines_are_whole_line_images_outside_code() {
        let text = "a\n![](/_system/_attachments/x.png)\n  ![cat](img/c.jpg \"Cat\")\nsee ![](y.png) here\n```\n![](z.png)\n```\n![](<sp ace.png>)";
        let lines = image_lines(text);
        let targets: Vec<_> = lines.iter().map(|l| l.target.as_str()).collect();
        assert_eq!(
            targets,
            ["/_system/_attachments/x.png", "img/c.jpg", "sp ace.png"]
        );
        assert_eq!(
            &text[lines[0].line.clone()],
            "![](/_system/_attachments/x.png)"
        );
    }

    #[test]
    fn inserted_images_get_their_own_lines() {
        let one = vec!["/a.png".to_string()];
        assert_eq!(image_insertion("", 0, &one), ("![](/a.png)\n".into(), 11));
        assert_eq!(
            image_insertion("ab", 1, &one),
            ("\n![](/a.png)\n".into(), 12)
        );
        assert_eq!(
            image_insertion("ab\n", 2, &one),
            ("\n![](/a.png)".into(), 12)
        );
        let two = vec!["/a.png".to_string(), "/b.png".to_string()];
        assert_eq!(
            image_insertion("x\n", 2, &two).0,
            "![](/a.png)\n![](/b.png)\n"
        );
    }
}
