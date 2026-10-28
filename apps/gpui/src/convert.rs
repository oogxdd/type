//! Read-only Markdown renderings of non-Markdown files for the preview pane.
//! Nothing here writes back: the preview never edits CSV, JSON or DOCX.
use std::{
    collections::HashMap,
    io::{Read, Seek},
    path::Path,
};

const MAX_TABLE_ROWS: usize = 1000;
const MAX_JSON_NODES: usize = 5000;
const MAX_JSON_DEPTH: usize = 24;
const MAX_DOCX_PART: u64 = 64 * 1024 * 1024;

/// Markdown for the preview of `path`, or `None` when the text already is Markdown.
pub fn preview_markdown(path: &Path, text: &str) -> Option<String> {
    let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
    match ext.as_str() {
        "csv" => Some(csv_to_markdown(text, None)),
        "tsv" | "tab" => Some(csv_to_markdown(text, Some('\t'))),
        "json" | "geojson" | "jsonc" => Some(json_to_markdown(text)),
        _ => None,
    }
}

pub fn is_docx(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("docx"))
}

/// Escape text so the Markdown renderer shows it literally.
fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '\\' | '`' | '*' | '_' | '[' | ']' | '<' | '>' | '|' | '~' | '#' | '!' | '$' => {
                out.push('\\');
                out.push(c);
            }
            '&' => out.push_str("&amp;"),
            '\r' => {}
            '\n' => out.push_str("<br>"),
            _ => out.push(c),
        }
    }
    out
}

fn table(rows: &[Vec<String>], total: usize) -> String {
    let width = rows.iter().map(Vec::len).max().unwrap_or(0).max(1);
    let mut out = String::new();
    for (index, row) in rows.iter().enumerate() {
        out.push('|');
        for column in 0..width {
            let cell = row.get(column).map(String::as_str).unwrap_or("");
            out.push(' ');
            out.push_str(if cell.trim().is_empty() && index == 0 {
                " "
            } else {
                cell
            });
            out.push_str(" |");
        }
        out.push('\n');
        if index == 0 {
            out.push('|');
            out.push_str(&" --- |".repeat(width));
            out.push('\n');
        }
    }
    if total > rows.len() {
        out.push_str(&format!(
            "\n*Showing the first {} of {} rows.*\n",
            rows.len().saturating_sub(1),
            total.saturating_sub(1)
        ));
    }
    out
}

/// RFC 4180 records. Excel's locale-dependent `;` is detected from the header.
pub fn parse_csv(text: &str, delimiter: Option<char>) -> Vec<Vec<String>> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let delimiter = delimiter.unwrap_or_else(|| {
        let header = text.lines().next().unwrap_or("");
        let mut quoted = false;
        let mut counts = [(',', 0), (';', 0), ('\t', 0)];
        for c in header.chars() {
            if c == '"' {
                quoted = !quoted;
            } else if !quoted {
                for (d, n) in &mut counts {
                    if c == *d {
                        *n += 1;
                    }
                }
            }
        }
        counts
            .iter()
            .max_by_key(|(d, n)| (*n, *d == ','))
            .map(|(d, _)| *d)
            .unwrap_or(',')
    });
    let mut rows = vec![];
    let mut row = vec![];
    let mut field = String::new();
    let mut chars = text.chars().peekable();
    let mut quoted = false;
    let mut started = false;
    while let Some(c) = chars.next() {
        started = true;
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    quoted = false;
                }
            } else {
                field.push(c);
            }
        } else if c == '"' && field.is_empty() {
            quoted = true;
        } else if c == delimiter {
            row.push(std::mem::take(&mut field));
        } else if c == '\n' || c == '\r' {
            if c == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            row.push(std::mem::take(&mut field));
            rows.push(std::mem::take(&mut row));
            started = false;
        } else {
            field.push(c);
        }
    }
    if started {
        row.push(field);
        rows.push(row);
    }
    rows
}

pub fn csv_to_markdown(text: &str, delimiter: Option<char>) -> String {
    let rows = parse_csv(text, delimiter);
    if rows
        .iter()
        .all(|row| row.iter().all(|cell| cell.is_empty()))
    {
        return "*Empty table.*\n".into();
    }
    let total = rows.len();
    let shown: Vec<Vec<String>> = rows
        .into_iter()
        .take(MAX_TABLE_ROWS + 1)
        .map(|row| row.iter().map(|cell| escape(cell)).collect())
        .collect();
    table(&shown, total)
}

fn fence(text: &str, lang: &str) -> String {
    let longest = text.split(|c| c != '`').map(str::len).max().unwrap_or(0);
    let marks = "`".repeat(longest.max(2) + 1);
    format!("{marks}{lang}\n{text}\n{marks}\n")
}

pub fn json_to_markdown(text: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(value) => {
            let mut out = Json {
                out: String::new(),
                nodes: 0,
            };
            out.top(&value);
            if out.nodes > MAX_JSON_NODES {
                out.out.push_str(
                    "\n*The preview is truncated. Turn the preview off to see the whole file.*\n",
                );
            }
            out.out
        }
        Err(error) => format!(
            "**Invalid JSON:** {}\n\n{}",
            escape(&error.to_string()),
            fence(text, "json")
        ),
    }
}

struct Json {
    out: String,
    nodes: usize,
}

fn scalar(value: &serde_json::Value) -> Option<String> {
    use serde_json::Value;
    Some(match value {
        Value::String(text) if text.is_empty() => "`\"\"`".into(),
        Value::String(text) => escape(text),
        Value::Array(items) if items.is_empty() => "`[]`".into(),
        Value::Object(map) if map.is_empty() => "`{}`".into(),
        Value::Array(_) | Value::Object(_) => return None,
        other => format!("`{other}`"),
    })
}

fn cell(value: &serde_json::Value) -> String {
    scalar(value).unwrap_or_else(|| {
        let mut text = value.to_string();
        if text.chars().count() > 200 {
            text = text.chars().take(200).collect::<String>() + "…";
        }
        escape(&text)
    })
}

/// Arrays of objects become tables; keys keep their first-seen order.
fn records(items: &[serde_json::Value]) -> Option<Vec<String>> {
    let mut keys: Vec<String> = vec![];
    for item in items {
        for key in item.as_object()?.keys() {
            if !keys.contains(key) {
                keys.push(key.clone());
            }
        }
    }
    (!items.is_empty()).then_some(keys)
}

impl Json {
    fn top(&mut self, value: &serde_json::Value) {
        use serde_json::Value;
        match value {
            Value::Object(map) if !map.is_empty() => {
                let mut scalars = String::new();
                for (key, value) in map {
                    if let Some(text) = scalar(value) {
                        scalars.push_str(&format!("- **{}**: {text}\n", escape(key)));
                    }
                }
                if !scalars.is_empty() {
                    self.out.push_str(&scalars);
                    self.out.push('\n');
                }
                for (key, value) in map {
                    if scalar(value).is_none() {
                        if self.nodes > MAX_JSON_NODES {
                            return;
                        }
                        self.out.push_str(&format!("### {}\n\n", escape(key)));
                        self.block(value);
                        self.out.push('\n');
                    }
                }
            }
            _ => self.block(value),
        }
    }

    fn block(&mut self, value: &serde_json::Value) {
        if let serde_json::Value::Array(items) = value {
            if let Some(keys) = records(items) {
                let mut rows = vec![keys.iter().map(|key| escape(key)).collect::<Vec<_>>()];
                for item in items.iter().take(MAX_TABLE_ROWS) {
                    let map = item.as_object().unwrap();
                    rows.push(
                        keys.iter()
                            .map(|key| map.get(key).map(cell).unwrap_or_default())
                            .collect(),
                    );
                }
                self.nodes += rows.len() * keys.len().max(1);
                self.out.push_str(&table(&rows, items.len() + 1));
                return;
            }
        }
        match scalar(value) {
            Some(text) => {
                self.out.push_str(&text);
                self.out.push('\n');
            }
            None => self.list(value, 0),
        }
    }

    fn list(&mut self, value: &serde_json::Value, depth: usize) {
        use serde_json::Value;
        let indent = "    ".repeat(depth);
        let children: Vec<(Option<&String>, &Value)> = match value {
            Value::Object(map) => map.iter().map(|(k, v)| (Some(k), v)).collect(),
            Value::Array(items) => items.iter().map(|v| (None, v)).collect(),
            _ => return,
        };
        for (key, child) in children {
            self.nodes += 1;
            if self.nodes > MAX_JSON_NODES {
                return;
            }
            let label = key.map(|key| format!("**{}**", escape(key)));
            match scalar(child) {
                Some(text) => match label {
                    Some(label) => self.out.push_str(&format!("{indent}- {label}: {text}\n")),
                    None => self.out.push_str(&format!("{indent}- {text}\n")),
                },
                None if depth >= MAX_JSON_DEPTH => {
                    let text = cell(child);
                    match label {
                        Some(label) => self.out.push_str(&format!("{indent}- {label}: {text}\n")),
                        None => self.out.push_str(&format!("{indent}- {text}\n")),
                    }
                }
                None => {
                    let kind = if child.is_array() {
                        "\\[…\\]"
                    } else {
                        "{…}"
                    };
                    self.out
                        .push_str(&format!("{indent}- {}\n", label.unwrap_or(kind.into())));
                    self.list(child, depth + 1);
                }
            }
        }
    }
}

/// A Word document flattened to Markdown. Images are referenced as
/// `docx:<part>` and carried with their bytes; unsupported formats are dropped.
#[derive(Debug, Default)]
pub struct Docx {
    pub markdown: String,
    pub images: HashMap<String, Vec<u8>>,
}

fn part<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
) -> Result<Option<String>, String> {
    let file = match archive.by_name(name) {
        Ok(file) => file,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let mut text = String::new();
    file.take(MAX_DOCX_PART + 1)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    if text.len() as u64 > MAX_DOCX_PART {
        return Err("This document is too large to preview.".into());
    }
    Ok(Some(text))
}

fn attr(e: &quick_xml::events::BytesStart, name: &[u8]) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.as_ref() == name)
        .and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()))
}

fn val(e: &quick_xml::events::BytesStart) -> Option<String> {
    attr(e, b"w:val")
}

fn on(e: &quick_xml::events::BytesStart) -> bool {
    !matches!(val(e).as_deref(), Some("0" | "false" | "off" | "none"))
}

fn xml_events(
    xml: &str,
    mut f: impl FnMut(quick_xml::events::Event, &mut String),
) -> Result<(), String> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut text = String::new();
    loop {
        match reader.read_event().map_err(|e| e.to_string())? {
            Event::Eof => return Ok(()),
            Event::Text(t) => {
                text.clear();
                text.push_str(&t.decode().map_err(|e| e.to_string())?);
                f(Event::Text(t), &mut text);
            }
            Event::GeneralRef(r) => {
                text.clear();
                if let Ok(Some(c)) = r.resolve_char_ref() {
                    text.push(c);
                } else if let Some(s) = r
                    .decode()
                    .ok()
                    .and_then(|name| quick_xml::escape::resolve_predefined_entity(&name))
                {
                    text.push_str(s);
                }
                f(Event::GeneralRef(r), &mut text);
            }
            event => f(event, &mut text),
        }
    }
}

fn local(name: &[u8]) -> &[u8] {
    name.rsplit(|b| *b == b':').next().unwrap_or(name)
}

#[derive(Default, Clone)]
struct Style {
    heading: Option<usize>,
    num: Option<(String, usize)>,
    based_on: Option<String>,
}

fn heading_from_name(name: &str) -> Option<usize> {
    let name = name.to_ascii_lowercase();
    if name == "title" {
        return Some(1);
    }
    name.strip_prefix("heading ")
        .and_then(|n| n.trim().parse::<usize>().ok())
        .map(|n| n.clamp(1, 6))
}

fn styles(xml: &str) -> HashMap<String, Style> {
    let mut styles = HashMap::new();
    let mut current: Option<(String, Style)> = None;
    let _ = xml_events(xml, |event, _| {
        use quick_xml::events::Event;
        match event {
            Event::Start(e) | Event::Empty(e) => match local(e.name().as_ref()) {
                b"style" => current = attr(&e, b"w:styleId").map(|id| (id, Style::default())),
                b"name" => {
                    if let Some((_, style)) = &mut current {
                        style.heading = style
                            .heading
                            .or(val(&e).and_then(|n| heading_from_name(&n)));
                    }
                }
                b"basedOn" => {
                    if let Some((_, style)) = &mut current {
                        style.based_on = val(&e);
                    }
                }
                b"outlineLvl" => {
                    if let Some((_, style)) = &mut current {
                        let level = val(&e).and_then(|n| n.parse::<usize>().ok());
                        style.heading = style.heading.or(level.filter(|n| *n < 6).map(|n| n + 1));
                    }
                }
                b"numId" => {
                    if let Some((_, style)) = &mut current {
                        if let Some(id) = val(&e) {
                            style.num = Some((id, style.num.as_ref().map_or(0, |n| n.1)));
                        }
                    }
                }
                b"ilvl" => {
                    if let Some((_, style)) = &mut current {
                        let level = val(&e).and_then(|n| n.parse().ok()).unwrap_or(0);
                        if let Some(num) = &mut style.num {
                            num.1 = level;
                        }
                    }
                }
                _ => {}
            },
            Event::End(e) if local(e.name().as_ref()) == b"style" => {
                if let Some((id, style)) = current.take() {
                    styles.insert(id, style);
                }
            }
            _ => {}
        }
    });
    styles
}

fn resolve_style(styles: &HashMap<String, Style>, id: &str) -> Style {
    let mut out = Style::default();
    let mut next = Some(id.to_owned());
    for _ in 0..10 {
        let Some(style) = next.and_then(|id| styles.get(&id)) else {
            break;
        };
        out.heading = out.heading.or(style.heading);
        out.num = out.num.or(style.num.clone());
        next = style.based_on.clone();
    }
    out
}

/// `numId -> ilvl -> ordered`.
fn numbering(xml: &str) -> HashMap<String, HashMap<usize, bool>> {
    let mut abstracts: HashMap<String, HashMap<usize, bool>> = HashMap::new();
    let mut nums: HashMap<String, String> = HashMap::new();
    let mut abstract_id: Option<String> = None;
    let mut level = 0;
    let mut num_id: Option<String> = None;
    let _ = xml_events(xml, |event, _| {
        use quick_xml::events::Event;
        if let Event::Start(e) | Event::Empty(e) = event {
            match local(e.name().as_ref()) {
                b"abstractNum" => abstract_id = attr(&e, b"w:abstractNumId"),
                b"lvl" => {
                    level = attr(&e, b"w:ilvl")
                        .and_then(|n| n.parse().ok())
                        .unwrap_or(0)
                }
                b"numFmt" => {
                    if let Some(id) = &abstract_id {
                        let ordered = !matches!(val(&e).as_deref(), Some("bullet" | "none") | None);
                        abstracts
                            .entry(id.clone())
                            .or_default()
                            .insert(level, ordered);
                    }
                }
                b"num" => {
                    abstract_id = None;
                    num_id = attr(&e, b"w:numId");
                }
                b"abstractNumId" => {
                    if let (Some(num), Some(target)) = (&num_id, val(&e)) {
                        nums.insert(num.clone(), target);
                    }
                }
                _ => {}
            }
        }
    });
    nums.into_iter()
        .filter_map(|(num, target)| Some((num, abstracts.get(&target)?.clone())))
        .collect()
}

fn relationships(xml: &str) -> HashMap<String, (String, bool)> {
    let mut rels = HashMap::new();
    let _ = xml_events(xml, |event, _| {
        use quick_xml::events::Event;
        if let Event::Start(e) | Event::Empty(e) = event {
            if local(e.name().as_ref()) == b"Relationship" {
                if let (Some(id), Some(target)) = (attr(&e, b"Id"), attr(&e, b"Target")) {
                    let external = attr(&e, b"TargetMode").as_deref() == Some("External");
                    rels.insert(id, (target, external));
                }
            }
        }
    });
    rels
}

#[derive(Clone, Copy, Default, PartialEq)]
struct Format {
    bold: bool,
    italic: bool,
    strike: bool,
}

#[derive(Default)]
struct Paragraph {
    style: Option<String>,
    heading: Option<usize>,
    num_id: Option<String>,
    level: Option<usize>,
    spans: Vec<(Format, Option<String>, String)>,
}

fn wrap(text: &str, marker: &str) -> String {
    let start = text.len() - text.trim_start().len();
    let end = text.trim_end().len();
    if start >= end {
        return text.into();
    }
    format!(
        "{}{marker}{}{marker}{}",
        &text[..start],
        &text[start..end],
        &text[end..]
    )
}

impl Paragraph {
    fn render(&self) -> String {
        let mut out = String::new();
        let mut index = 0;
        while index < self.spans.len() {
            // Merge adjacent runs with equal formatting: Word splits words freely.
            let (format, link, _) = &self.spans[index];
            let mut text = String::new();
            while let Some((_, _, t)) = self
                .spans
                .get(index)
                .filter(|(f, l, _)| f == format && l == link)
            {
                text.push_str(t);
                index += 1;
            }
            if format.strike {
                text = wrap(&text, "~~");
            }
            if format.italic {
                text = wrap(&text, "*");
            }
            if format.bold {
                text = wrap(&text, "**");
            }
            match link {
                Some(url) if !text.trim().is_empty() => out.push_str(&format!(
                    "[{text}](<{}>)",
                    url.replace(['<', '>', '\n'], "")
                )),
                _ => out.push_str(&text),
            }
        }
        out.trim().to_owned()
    }
}

#[derive(Default)]
struct Table {
    rows: Vec<Vec<String>>,
    cell: Option<Vec<String>>,
}

pub fn docx_to_markdown<R: Read + Seek>(reader: R) -> Result<Docx, String> {
    use quick_xml::events::Event;
    let mut archive = zip::ZipArchive::new(reader)
        .map_err(|_| "This file is not a valid DOCX document.".to_string())?;
    let document = part(&mut archive, "word/document.xml")?
        .ok_or("This file is not a valid DOCX document.")?;
    let styles = styles(&part(&mut archive, "word/styles.xml")?.unwrap_or_default());
    let numbering = numbering(&part(&mut archive, "word/numbering.xml")?.unwrap_or_default());
    let rels =
        relationships(&part(&mut archive, "word/_rels/document.xml.rels")?.unwrap_or_default());

    let mut blocks: Vec<(bool, String)> = vec![];
    let mut tables: Vec<Table> = vec![];
    let mut paragraph: Option<Paragraph> = None;
    let mut format = Format::default();
    let mut link: Option<String> = None;
    let mut in_ppr = false;
    let mut in_rpr = false;
    let mut in_text = false;
    let mut skip = 0usize;
    let mut images: Vec<String> = vec![];

    xml_events(&document, |event, text| match event {
        Event::Start(e) if hidden(e.name().as_ref()) => skip += 1,
        Event::End(e) if skip > 0 && hidden(e.name().as_ref()) => skip -= 1,
        _ if skip > 0 => {}
        Event::Start(e) => match local(e.name().as_ref()) {
            b"tbl" => tables.push(Table::default()),
            b"tr" => {
                if let Some(table) = tables.last_mut() {
                    table.rows.push(vec![]);
                }
            }
            b"tc" => {
                if let Some(table) = tables.last_mut() {
                    table.cell = Some(vec![]);
                }
            }
            b"p" => paragraph = Some(Paragraph::default()),
            b"pPr" => in_ppr = true,
            b"rPr" => in_rpr = true,
            b"r" => format = Format::default(),
            b"t" => in_text = true,
            b"hyperlink" => {
                link = attr(&e, b"r:id")
                    .and_then(|id| rels.get(&id))
                    .filter(|(_, external)| *external)
                    .map(|(target, _)| target.clone());
            }
            _ => {}
        },
        Event::Empty(e) => {
            let name = local(e.name().as_ref()).to_vec();
            match name.as_slice() {
                b"pStyle" if in_ppr => {
                    if let Some(p) = &mut paragraph {
                        p.style = val(&e);
                    }
                }
                b"outlineLvl" if in_ppr => {
                    if let Some(p) = &mut paragraph {
                        p.heading = val(&e)
                            .and_then(|n| n.parse::<usize>().ok())
                            .filter(|n| *n < 6)
                            .map(|n| n + 1);
                    }
                }
                b"numId" if in_ppr => {
                    if let Some(p) = &mut paragraph {
                        p.num_id = val(&e);
                    }
                }
                b"ilvl" if in_ppr => {
                    if let Some(p) = &mut paragraph {
                        p.level = val(&e).and_then(|n| n.parse().ok());
                    }
                }
                b"b" if in_rpr && !in_ppr => format.bold = on(&e),
                b"i" if in_rpr && !in_ppr => format.italic = on(&e),
                b"strike" | b"dstrike" if in_rpr && !in_ppr => format.strike = on(&e),
                b"tab" if !in_ppr => push(&mut paragraph, format, &link, "\t"),
                b"br" | b"cr" => push(&mut paragraph, format, &link, "\n"),
                b"blip" => {
                    let target = attr(&e, b"r:embed")
                        .and_then(|id| rels.get(&id))
                        .filter(|(_, external)| !external)
                        .map(|(target, _)| target.trim_start_matches('/').to_owned());
                    if let Some(target) = target {
                        let part = if target.starts_with("word/") {
                            target
                        } else {
                            format!("word/{target}")
                        };
                        images.push(part.clone());
                        if let Some(p) = &mut paragraph {
                            p.spans
                                .push((Format::default(), None, format!("![](docx:{part})")));
                        }
                    }
                }
                _ => {}
            }
        }
        Event::Text(_) | Event::GeneralRef(_) if in_text => {
            push(&mut paragraph, format, &link, &escape(text));
        }
        Event::End(e) => match local(e.name().as_ref()) {
            b"pPr" => in_ppr = false,
            b"rPr" => in_rpr = false,
            b"t" => in_text = false,
            b"hyperlink" => link = None,
            b"p" => {
                let Some(p) = paragraph.take() else { return };
                let style = p
                    .style
                    .as_deref()
                    .map(|id| resolve_style(&styles, id))
                    .unwrap_or_default();
                let body = p.render();
                if body.is_empty() {
                    return;
                }
                if let Some(table) = tables.last_mut() {
                    if let Some(cell) = &mut table.cell {
                        cell.push(body);
                    }
                    return;
                }
                // numId 0 explicitly removes a style's numbering.
                let num = p
                    .num_id
                    .clone()
                    .or(style.num.as_ref().map(|n| n.0.clone()))
                    .filter(|id| id != "0")
                    .map(|id| (id, p.level.or(style.num.as_ref().map(|n| n.1)).unwrap_or(0)));
                if let Some(level) = p.heading.or(style.heading).filter(|_| num.is_none()) {
                    blocks.push((false, format!("{} {body}", "#".repeat(level))));
                } else if let Some((id, level)) = num {
                    let ordered = numbering
                        .get(&id)
                        .and_then(|levels| levels.get(&level))
                        .copied()
                        .unwrap_or(false);
                    let indent = "    ".repeat(level.min(8));
                    blocks.push((
                        true,
                        format!("{indent}{} {body}", if ordered { "1." } else { "-" }),
                    ));
                } else {
                    blocks.push((false, body));
                }
            }
            b"tc" => {
                if let Some(table) = tables.last_mut() {
                    let cell = table.cell.take().unwrap_or_default().join("<br>");
                    if let Some(row) = table.rows.last_mut() {
                        row.push(cell);
                    }
                }
            }
            b"tbl" => {
                let Some(table) = tables.pop() else { return };
                let rows: Vec<Vec<String>> = table
                    .rows
                    .into_iter()
                    .filter(|row| !row.is_empty())
                    .collect();
                if rows.is_empty() {
                    return;
                }
                match tables.last_mut().and_then(|outer| outer.cell.as_mut()) {
                    // Markdown tables cannot nest; flatten inner rows into the cell.
                    Some(cell) => cell.extend(rows.iter().map(|row| row.join(" · "))),
                    None => blocks.push((false, table_rows(&rows))),
                }
            }
            _ => {}
        },
        _ => {}
    })?;

    let mut markdown = String::new();
    let mut previous_list = false;
    for (list, block) in blocks {
        if !markdown.is_empty() {
            markdown.push_str(if list && previous_list { "\n" } else { "\n\n" });
        }
        markdown.push_str(&block);
        previous_list = list;
    }
    markdown.push('\n');
    if markdown.trim().is_empty() {
        markdown = "*This document has no text.*\n".into();
    }
    let mut out = Docx {
        markdown,
        images: HashMap::new(),
    };
    for name in images {
        if out.images.contains_key(&name) || image_format(&name).is_none() {
            continue;
        }
        if let Ok(file) = archive.by_name(&name) {
            let mut bytes = vec![];
            if file.take(MAX_DOCX_PART + 1).read_to_end(&mut bytes).is_ok()
                && (bytes.len() as u64) <= MAX_DOCX_PART
            {
                out.images.insert(name, bytes);
            }
        }
    }
    Ok(out)
}

/// Elements whose content is hidden: deleted revisions, field codes, fallbacks.
fn hidden(name: &[u8]) -> bool {
    matches!(
        local(name),
        b"del" | b"instrText" | b"delText" | b"Fallback"
    )
}

fn push(paragraph: &mut Option<Paragraph>, format: Format, link: &Option<String>, text: &str) {
    if let Some(p) = paragraph {
        let text = if text == "\n" { "<br>" } else { text };
        p.spans.push((format, link.clone(), text.to_owned()));
    }
}

fn table_rows(rows: &[Vec<String>]) -> String {
    table(rows, rows.len()).trim_end().to_owned()
}

/// Lowercase extension of a DOCX media part the renderer can decode.
pub fn image_format(name: &str) -> Option<&'static str> {
    let ext = Path::new(name)
        .extension()?
        .to_string_lossy()
        .to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "png",
        "jpg" | "jpeg" => "jpeg",
        "gif" => "gif",
        "webp" => "webp",
        "bmp" => "bmp",
        "tif" | "tiff" => "tiff",
        "svg" => "svg",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    #[test]
    fn csv_quotes_semicolons_and_markdown_are_literal() {
        let md = csv_to_markdown(
            "name;note\n\"Ann\";\"a|b **x**\nline\"\nBob;\"say \"\"hi\"\"\"\n",
            None,
        );
        assert_eq!(
            md,
            "| name | note |\n| --- | --- |\n| Ann | a\\|b \\*\\*x\\*\\*<br>line |\n| Bob | say \"hi\" |\n"
        );
        assert_eq!(
            parse_csv("a,b\r\n1,\r\n", None),
            vec![vec!["a", "b"], vec!["1", ""]]
        );
        assert_eq!(parse_csv("a\tb", Some('\t')), vec![vec!["a", "b"]]);
        assert_eq!(csv_to_markdown("", None), "*Empty table.*\n");
    }

    #[test]
    fn json_records_become_tables_and_objects_become_outlines() {
        let md = json_to_markdown(
            r#"{"name":"demo","count":2,"items":[{"id":1,"tag":"a"},{"id":2,"extra":true}],"nested":{"deep":[1,"x"]}}"#,
        );
        assert!(
            md.starts_with("- **name**: demo\n- **count**: `2`\n"),
            "{md}"
        );
        assert!(md.contains("### items\n\n| id | tag | extra |\n| --- | --- | --- |\n| `1` | a |  |\n| `2` |  | `true` |\n"), "{md}");
        assert!(
            md.contains("### nested\n\n- **deep**\n    - `1`\n    - x\n"),
            "{md}"
        );
        let bad = json_to_markdown("{\"a\": ```}");
        assert!(
            bad.starts_with("**Invalid JSON:**") && bad.contains("````json\n{\"a\": ```}\n````"),
            "{bad}"
        );
    }

    fn docx(document: &str, extra: &[(&str, &[u8])]) -> Vec<u8> {
        let mut bytes = Cursor::new(vec![]);
        let mut zip = zip::ZipWriter::new(&mut bytes);
        let options = zip::write::FileOptions::default();
        let body = format!(
            r#"<?xml version="1.0"?><w:document xmlns:w="w" xmlns:r="r"><w:body>{document}</w:body></w:document>"#
        );
        zip.start_file("word/document.xml", options).unwrap();
        zip.write_all(body.as_bytes()).unwrap();
        for (name, data) in extra {
            zip.start_file(*name, options).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap();
        drop(zip);
        bytes.into_inner()
    }

    #[test]
    fn docx_headings_lists_tables_links_and_images() {
        let styles = br#"<w:styles xmlns:w="w"><w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/></w:style></w:styles>"#;
        let numbering = br#"<w:numbering xmlns:w="w"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num></w:numbering>"#;
        let rels = br#"<Relationships><Relationship Id="rId1" Target="https://example.com/a b" TargetMode="External"/><Relationship Id="rId2" Target="media/image1.png"/></Relationships>"#;
        let document = concat!(
            r#"<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>Plan &amp; goals</w:t></w:r></w:p>"#,
            r#"<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Bold </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>run</w:t></w:r><w:r><w:t xml:space="preserve"> and *stars* </w:t></w:r><w:hyperlink r:id="rId1"><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>"#,
            r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr></w:pPr><w:r><w:t>First</w:t></w:r></w:p>"#,
            r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="5"/></w:numPr></w:pPr><w:r><w:t>Sub</w:t></w:r></w:p>"#,
            r#"<w:p><w:r><w:t>Kept</w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>"#,
            r#"<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B|C</w:t></w:r></w:p></w:tc></w:tr>"#,
            r#"<w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>"#,
            r#"<w:p><w:r><w:drawing><a:blip xmlns:a="a" r:embed="rId2"/></w:drawing></w:r></w:p>"#,
        );
        let bytes = docx(
            document,
            &[
                ("word/styles.xml", styles),
                ("word/numbering.xml", numbering),
                ("word/_rels/document.xml.rels", rels),
                ("word/media/image1.png", b"png-bytes"),
            ],
        );
        let doc = docx_to_markdown(Cursor::new(bytes)).unwrap();
        assert_eq!(
            doc.markdown,
            concat!(
                "# Plan &amp; goals\n\n",
                "**Bold run** and \\*stars\\* [link](<https://example.com/a b>)\n\n",
                "1. First\n    - Sub\n\n",
                "Kept\n\n",
                "| A | B\\|C |\n| --- | --- |\n| 1<br>2 |  |\n\n",
                "![](docx:word/media/image1.png)\n"
            )
        );
        assert_eq!(doc.images["word/media/image1.png"], b"png-bytes");
        assert!(docx_to_markdown(Cursor::new(b"not a zip".to_vec())).is_err());
    }
}
