//! Apple Notes import.
//!
//! Imports an *exported* Apple Notes folder tree into the active profile's notes
//! root. Apple Notes has no native bulk export, so users export with a tool such
//! as the free "Exporter" app, which produces a nested folder of Markdown (and
//! sometimes HTML / plain-text) files. This adapter walks that tree and creates
//! app notes, preserving each note's original creation date.
//!
//! Two modes:
//!   * `preserve` — recreate the source folder hierarchy under a single target
//!                  folder in the notes root.
//!   * `flatten`  — drop every note directly into `Feed`, discarding hierarchy.
//!
//! Creation dates come from YAML front-matter (`created` / `date` / `created_ms`
//! …) when present, otherwise the source file's filesystem timestamps.
//!
//! Progress is exposed via a process-global snapshot that the frontend polls —
//! matching the recordings/handwriting queue pattern (the app uses no Tauri
//! events). The actual work runs on a detached worker thread spawned by the
//! command layer; only the resolved notes root + args cross the boundary, so the
//! worker never touches the `AppHandle`. Body encryption still works because
//! `write_note_with_front_matter` reads the unlocked key from the global
//! security runtime.

use crate::AppEnv;
use crate::ports::import::ImportGateway;
use crate::*;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use time::format_description::well_known::Rfc3339;
use time::macros::format_description;
use time::{Date, OffsetDateTime, PrimitiveDateTime};

/// File extensions we treat as importable note text.
const TEXT_EXTENSIONS: &[&str] = &["md", "markdown", "txt", "text", "html", "htm"];
/// Front-matter keys that may carry the original creation date, in priority order.
const CREATED_KEYS: &[&str] = &[
    "created_ms",
    "created",
    "creationdate",
    "created_at",
    "date",
    "created-date",
];
/// Cap on per-note errors retained for the UI so a pathological import can't grow
/// the snapshot without bound.
const MAX_TRACKED_ERRORS: usize = 25;
/// Default target folder when preserving structure and no name is supplied.
const DEFAULT_IMPORT_FOLDER: &str = "Imported Notes";

/// Core import gateway. Resolving the active profile and spawning the
/// worker are adapter concerns because both depend on process/runtime state.
pub struct ImportAdapter {
    app: AppEnv,
}

impl ImportAdapter {
    pub fn new(app: AppEnv) -> Self {
        Self { app }
    }
}

impl ImportGateway for ImportAdapter {
    type Scan = AppleImportScan;
    type Args = AppleImportArgs;
    type State = AppleImportState;

    fn scan(&self, path: &str) -> Result<Self::Scan, String> {
        scan_apple_import_source(Path::new(path.trim()))
    }

    fn start(&self, args: Self::Args) -> Result<(), String> {
        let notes_root = ensured_notes_root(&self.app)?;
        let target_label = match args.mode {
            AppleImportMode::Flatten => "Feed".to_string(),
            AppleImportMode::Preserve => args
                .target_folder
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| "Imported Notes".to_string()),
        };
        begin_apple_import(target_label)?;
        std::thread::spawn(move || run_apple_notes_import(notes_root, args));
        Ok(())
    }

    fn status(&self) -> Result<Self::State, String> {
        Ok(apple_import_snapshot())
    }
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Preview of an export folder, returned before the import runs.
#[derive(Clone, Serialize)]
pub struct AppleImportScan {
    /// Number of importable note files found (recursive).
    pub note_count: u32,
    /// Number of distinct sub-folders that contain notes.
    pub folder_count: u32,
    /// Non-text files skipped (attachments, images, …).
    pub skipped_files: u32,
    /// Base name of the chosen folder — the default target-folder suggestion.
    pub source_name: String,
    /// A handful of note titles, so the UI can show what will be imported.
    pub sample_titles: Vec<String>,
}

/// Whether to mirror the source hierarchy or collapse everything into Feed.
#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppleImportMode {
    Preserve,
    Flatten,
}

/// Arguments for an import run.
#[derive(Deserialize)]
pub struct AppleImportArgs {
    pub source_path: String,
    pub mode: AppleImportMode,
    /// Target folder name for `preserve` mode. Defaults to the source base name.
    #[serde(default)]
    pub target_folder: Option<String>,
    /// New-note filename strategy (mirrors the active profile setting).
    #[serde(default)]
    pub file_name_format: NoteFileNameFormat,
}

/// Live, pollable progress for the current/last import.
#[derive(Clone, Default, Serialize)]
pub struct AppleImportState {
    pub running: bool,
    pub done: bool,
    pub total: u32,
    pub processed: u32,
    pub imported: u32,
    pub skipped: u32,
    pub failed: u32,
    pub folders_created: u32,
    /// Title of the note currently being written.
    pub current: String,
    /// Resolved destination folder (for the UI summary).
    pub target_folder: String,
    /// Fatal error that aborted the whole run, if any.
    pub error: Option<String>,
    /// Sample of per-note failures (capped at `MAX_TRACKED_ERRORS`).
    pub errors: Vec<String>,
}

// ── Progress state ─────────────────────────────────────────────────────────────

fn import_state() -> &'static Mutex<AppleImportState> {
    static STATE: OnceLock<Mutex<AppleImportState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(AppleImportState::default()))
}

/// Snapshot the current progress for the polling UI.
pub fn apple_import_snapshot() -> AppleImportState {
    import_state()
        .lock()
        .map(|state| state.clone())
        .unwrap_or_default()
}

/// Claim the single import slot, resetting progress. Errors if one is running.
pub fn begin_apple_import(target_folder: String) -> Result<(), String> {
    let mut state = import_state()
        .lock()
        .map_err(|_| "Import state is unavailable.".to_string())?;
    if state.running {
        return Err("An import is already running.".to_string());
    }
    *state = AppleImportState {
        running: true,
        target_folder,
        ..Default::default()
    };
    Ok(())
}

/// Mutate the shared progress state, ignoring lock poisoning.
fn with_state(update: impl FnOnce(&mut AppleImportState)) {
    if let Ok(mut state) = import_state().lock() {
        update(&mut state);
    }
}

// ── Source scanning ──────────────────────────────────────────────────────────

/// A single importable file plus its POSIX-style directory relative to the root.
struct ImportFile {
    path: PathBuf,
    rel_dir: String,
}

/// Produce a preview of what an export folder contains.
pub fn scan_apple_import_source(source: &Path) -> Result<AppleImportScan, String> {
    if !source.exists() || !source.is_dir() {
        return Err("The selected path is not a folder.".to_string());
    }
    let (files, skipped) = collect_import_files(source);
    let mut folders: HashSet<String> = HashSet::new();
    for file in &files {
        if !file.rel_dir.is_empty() {
            folders.insert(file.rel_dir.clone());
        }
    }
    let sample_titles = files
        .iter()
        .take(6)
        .map(|file| title_from_path(&file.path))
        .collect();
    Ok(AppleImportScan {
        note_count: files.len() as u32,
        folder_count: folders.len() as u32,
        skipped_files: skipped,
        source_name: source
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| DEFAULT_IMPORT_FOLDER.to_string()),
        sample_titles,
    })
}

/// Walk the source tree, returning importable files and the count of files
/// skipped because they are not note text (attachments, images, …).
fn collect_import_files(source: &Path) -> (Vec<ImportFile>, u32) {
    let mut files = Vec::new();
    let mut skipped = 0u32;
    walk_dir(source, "", &mut files, &mut skipped);
    (files, skipped)
}

fn walk_dir(dir: &Path, rel: &str, files: &mut Vec<ImportFile>, skipped: &mut u32) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip dotfiles (.DS_Store, .git, …) and the app's own order metadata.
        if name.starts_with('.') {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if file_type.is_dir() {
            let child_rel = if rel.is_empty() {
                name
            } else {
                format!("{}/{}", rel, name)
            };
            walk_dir(&path, &child_rel, files, skipped);
        } else if file_type.is_file() {
            if has_text_extension(&path) {
                files.push(ImportFile {
                    path,
                    rel_dir: rel.to_string(),
                });
            } else {
                *skipped += 1;
            }
        }
    }
}

fn has_text_extension(path: &Path) -> bool {
    extension_lower(path)
        .map(|ext| TEXT_EXTENSIONS.contains(&ext.as_str()))
        .unwrap_or(false)
}

fn extension_lower(path: &Path) -> Option<String> {
    path.extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
}

/// A human-ish title for progress/preview: the file stem.
fn title_from_path(path: &Path) -> String {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".to_string())
}

// ── Import worker ──────────────────────────────────────────────────────────────

/// Per-note outcome.
enum Imported {
    Created,
}

/// Run the import to completion, then mark the shared state finished. Spawned on
/// a detached worker thread by the command layer.
pub fn run_apple_notes_import(notes_root: PathBuf, args: AppleImportArgs) {
    let result = import_inner(&notes_root, &args);
    with_state(|state| {
        state.running = false;
        state.done = true;
        if let Err(err) = result {
            state.error = Some(err);
        }
    });
}

fn import_inner(notes_root: &Path, args: &AppleImportArgs) -> Result<(), String> {
    let source = PathBuf::from(args.source_path.trim());
    if !source.is_dir() {
        return Err("The selected source folder no longer exists.".to_string());
    }

    let base_target = match args.mode {
        AppleImportMode::Flatten => FEED_FOLDER.to_string(),
        AppleImportMode::Preserve => resolve_preserve_target(&source, args),
    };

    // Reject a target that resolves into hidden storage (Recordings/attachments).
    if is_storage_folder_path(notes_root, &join_rel(notes_root, &base_target)) {
        return Err("Choose a different target folder — that name is reserved.".to_string());
    }
    with_state(|state| state.target_folder = base_target.clone());

    let (files, _skipped) = collect_import_files(&source);
    with_state(|state| state.total = files.len() as u32);

    let mut created_folders: HashSet<String> = HashSet::new();
    for file in &files {
        with_state(|state| state.current = title_from_path(&file.path));
        let outcome = import_one(notes_root, &base_target, args, file, &mut created_folders);
        with_state(|state| {
            state.processed += 1;
            match outcome {
                Ok(Imported::Created) => state.imported += 1,
                Err(ref err) => {
                    state.failed += 1;
                    if state.errors.len() < MAX_TRACKED_ERRORS {
                        state
                            .errors
                            .push(format!("{}: {}", title_from_path(&file.path), err));
                    }
                }
            }
            state.folders_created = created_folders.len() as u32;
        });
    }
    Ok(())
}

fn import_one(
    notes_root: &Path,
    base_target: &str,
    args: &AppleImportArgs,
    file: &ImportFile,
    created_folders: &mut HashSet<String>,
) -> Result<Imported, String> {
    let parsed = read_and_parse_note(file)?;

    let folder_rel = match args.mode {
        AppleImportMode::Flatten => FEED_FOLDER.to_string(),
        AppleImportMode::Preserve => {
            let sub = sanitize_rel_path(&file.rel_dir);
            if sub.is_empty() {
                base_target.to_string()
            } else {
                format!("{}/{}", base_target, sub)
            }
        }
    };

    let folder_full = join_rel(notes_root, &folder_rel);
    if is_storage_folder_path(notes_root, &folder_full) {
        return Err("Destination resolves to reserved storage.".to_string());
    }
    fs::create_dir_all(&folder_full).map_err(|err| err.to_string())?;
    created_folders.insert(folder_rel);

    let note_id = generate_note_id();
    let file_name = allocate_note_file_name(
        &folder_full,
        parsed.created_ms,
        &note_id,
        &parsed.body,
        "imported-note",
        args.file_name_format,
    )?;
    let path = folder_full.join(&file_name);

    let meta = NoteFrontMatter {
        id: Some(note_id),
        created_ms: Some(parsed.created_ms),
        updated_ms: Some(parsed.created_ms),
        imported_from_apple_notes: Some(true),
        ..Default::default()
    };
    write_note_with_front_matter(&path, &meta, &parsed.body)?;
    if !is_feed_folder_path(notes_root, &folder_full) {
        update_order_append(&folder_full, std::slice::from_ref(&file_name), false)?;
    }
    Ok(Imported::Created)
}

/// Resolve + sanitize the single top-level folder for `preserve` mode.
fn resolve_preserve_target(source: &Path, args: &AppleImportArgs) -> String {
    let requested = args
        .target_folder
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(sanitize_segment)
        .filter(|value| !value.is_empty());
    requested
        .or_else(|| {
            source
                .file_name()
                .map(|name| sanitize_segment(&name.to_string_lossy()))
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| DEFAULT_IMPORT_FOLDER.to_string())
}

/// Join a POSIX-style relative path onto a root using native separators.
fn join_rel(root: &Path, rel: &str) -> PathBuf {
    let mut path = root.to_path_buf();
    for segment in rel.split('/') {
        if !segment.is_empty() {
            path.push(segment);
        }
    }
    path
}

/// Strip characters that are illegal/awkward in folder names; returns "" if the
/// whole segment is unusable.
fn sanitize_segment(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            ch if ch.is_control() => ' ',
            ch => ch,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed == "." || trimmed == ".." {
        return String::new();
    }
    trimmed.to_string()
}

/// Sanitize each segment of a relative directory, dropping empties.
fn sanitize_rel_path(rel: &str) -> String {
    rel.split('/')
        .map(sanitize_segment)
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

// ── Note parsing ─────────────────────────────────────────────────────────────

struct ParsedNote {
    body: String,
    created_ms: i64,
}

fn read_and_parse_note(file: &ImportFile) -> Result<ParsedNote, String> {
    let raw = fs::read_to_string(&file.path).map_err(|err| err.to_string())?;
    let is_html = matches!(extension_lower(&file.path).as_deref(), Some("html" | "htm"));

    let (front_matter_date, body) = if is_html {
        (None, html_to_markdown(&raw))
    } else {
        let (date, stripped) = split_front_matter(&raw);
        (date, stripped)
    };

    let created_ms = front_matter_date
        .or_else(|| file_created_ms(&file.path))
        .or_else(now_ms)
        .unwrap_or(0);

    // Keep the title in-body (Apple Notes keeps the title as the first line). If
    // the note is empty, fall back to the filename so it survives as a titled note.
    let body = if body.trim().is_empty() {
        title_from_path(&file.path)
    } else {
        body
    };

    Ok(ParsedNote { body, created_ms })
}

/// Split a leading YAML front-matter block (if any) from the body, extracting the
/// best creation date. Foreign front-matter is always removed so it never leaks
/// into the imported note body.
fn split_front_matter(raw: &str) -> (Option<i64>, String) {
    let normalized = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let mut lines = normalized.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (None, normalized.to_string());
    }

    let mut fields: HashMap<String, String> = HashMap::new();
    let mut closed = false;
    // Track byte offsets as we go (`lines()` drops separators, so we re-walk
    // with `split_inclusive` from just past the opening fence). When we hit the
    // closing fence, `offset` already points at the start of the body.
    let body_scan_start = normalized
        .find('\n')
        .map(|idx| idx + 1)
        .unwrap_or(normalized.len());
    let mut offset = body_scan_start;
    for line in normalized[body_scan_start..].split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\n', '\r']);
        offset += line.len();
        if trimmed.trim() == "---" {
            closed = true;
            break;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            fields.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    if !closed {
        // No closing fence — treat the whole thing as body (a lone "---" line).
        return (None, normalized.to_string());
    }

    let date = CREATED_KEYS
        .iter()
        .find_map(|key| fields.get(*key))
        .and_then(|value| parse_date_value(value));
    let body = normalized[offset..]
        .trim_start_matches(['\n', '\r'])
        .to_string();
    (date, body)
}

/// Parse a front-matter date value into epoch milliseconds.
fn parse_date_value(value: &str) -> Option<i64> {
    let v = value.trim().trim_matches(|c| c == '"' || c == '\'').trim();
    if v.is_empty() {
        return None;
    }
    // Bare epoch number: milliseconds if large, otherwise seconds.
    if let Ok(num) = v.parse::<i64>() {
        return Some(if num >= 1_000_000_000_000 {
            num
        } else {
            num.saturating_mul(1000)
        });
    }
    // RFC 3339 / ISO 8601 with timezone.
    if let Ok(dt) = OffsetDateTime::parse(v, &Rfc3339) {
        return i64::try_from(dt.unix_timestamp_nanos() / 1_000_000).ok();
    }
    // "YYYY-MM-DD HH:MM:SS" (assume UTC).
    let datetime_fmt = format_description!("[year]-[month]-[day] [hour]:[minute]:[second]");
    if let Ok(dt) = PrimitiveDateTime::parse(v, &datetime_fmt) {
        return Some(dt.assume_utc().unix_timestamp().saturating_mul(1000));
    }
    // Date only.
    let date_fmt = format_description!("[year]-[month]-[day]");
    if let Ok(date) = Date::parse(v, &date_fmt) {
        return Some(
            date.midnight()
                .assume_utc()
                .unix_timestamp()
                .saturating_mul(1000),
        );
    }
    None
}

/// Filesystem creation time (or modified, if birthtime is unavailable) in ms.
fn file_created_ms(path: &Path) -> Option<i64> {
    let meta = fs::metadata(path).ok()?;
    let time = meta.created().or_else(|_| meta.modified()).ok()?;
    time_to_ms(time)
}

// ── HTML → Markdown ──────────────────────────────────────────────────────────

/// Best-effort HTML → Markdown for Apple Notes exports. Apple Notes HTML is
/// simple and regular (headings, paragraphs, `<div>`/`<br>` breaks, bold/italic,
/// lists, links), so a focused converter avoids pulling in a full HTML crate.
fn html_to_markdown(html: &str) -> String {
    let without_meta = strip_blocks(html, &["head", "style", "script"]);
    let with_links = rewrite_anchors(&without_meta);

    let bytes = with_links.as_bytes();
    let mut out = String::with_capacity(with_links.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'<' {
            // Read to the closing '>'.
            let Some(end_rel) = with_links[i..].find('>') else {
                break;
            };
            let tag = &with_links[i + 1..i + end_rel];
            out.push_str(&render_tag(tag));
            i += end_rel + 1;
        } else {
            out.push(bytes[i] as char);
            i += 1;
        }
    }

    let decoded = decode_entities(&out);
    collapse_whitespace(&decoded)
}

/// Translate a single tag (contents between `<` and `>`) into Markdown glue.
fn render_tag(tag: &str) -> String {
    let trimmed = tag.trim();
    let is_close = trimmed.starts_with('/');
    let name: String = trimmed
        .trim_start_matches('/')
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();

    match name.as_str() {
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
            if is_close {
                "\n\n".to_string()
            } else {
                let level = name[1..].parse::<usize>().unwrap_or(1);
                format!("\n{} ", "#".repeat(level))
            }
        }
        "br" => "\n".to_string(),
        "p" | "div" => "\n".to_string(),
        "li" => {
            if is_close {
                "\n".to_string()
            } else {
                "- ".to_string()
            }
        }
        "ul" | "ol" => "\n".to_string(),
        "blockquote" => {
            if is_close {
                "\n".to_string()
            } else {
                "\n> ".to_string()
            }
        }
        "b" | "strong" => "**".to_string(),
        "i" | "em" => "*".to_string(),
        "code" => "`".to_string(),
        _ => String::new(),
    }
}

/// Rewrite `<a href="URL">TEXT</a>` into `[TEXT](URL)` before generic stripping.
fn rewrite_anchors(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let lower = html.to_ascii_lowercase();
    let mut cursor = 0usize;
    while let Some(rel) = lower[cursor..].find("<a ") {
        let start = cursor + rel;
        out.push_str(&html[cursor..start]);
        // Find end of the opening tag.
        let Some(open_end_rel) = html[start..].find('>') else {
            out.push_str(&html[start..]);
            return out;
        };
        let open_end = start + open_end_rel;
        let open_tag = &html[start..=open_end];
        let href = extract_attr(open_tag, "href").unwrap_or_default();
        // Find the matching close.
        let Some(close_rel) = lower[open_end..].find("</a>") else {
            out.push_str(&html[start..]);
            return out;
        };
        let close = open_end + close_rel;
        let text = &html[open_end + 1..close];
        if href.is_empty() {
            out.push_str(text);
        } else {
            out.push_str(&format!("[{}]({})", text.trim(), href));
        }
        cursor = close + "</a>".len();
    }
    out.push_str(&html[cursor..]);
    out
}

/// Pull a quoted attribute value out of an opening tag.
fn extract_attr(tag: &str, attr: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let key = format!("{}=", attr);
    let key_at = lower.find(&key)?;
    let after = &tag[key_at + key.len()..];
    let after = after.trim_start();
    let quote = after.chars().next()?;
    if quote == '"' || quote == '\'' {
        let rest = &after[1..];
        let end = rest.find(quote)?;
        Some(rest[..end].to_string())
    } else {
        Some(after.split_whitespace().next().unwrap_or("").to_string())
    }
}

/// Remove whole `<tag>…</tag>` blocks (case-insensitive) for the given tag names.
fn strip_blocks(html: &str, tags: &[&str]) -> String {
    let mut result = html.to_string();
    for tag in tags {
        let lower = result.to_ascii_lowercase();
        let open = format!("<{}", tag);
        let close = format!("</{}>", tag);
        let mut out = String::with_capacity(result.len());
        let mut cursor = 0usize;
        let lower_ref = lower.as_str();
        while let Some(rel) = lower_ref[cursor..].find(&open) {
            let start = cursor + rel;
            out.push_str(&result[cursor..start]);
            if let Some(close_rel) = lower_ref[start..].find(&close) {
                cursor = start + close_rel + close.len();
            } else {
                cursor = result.len();
            }
        }
        out.push_str(&result[cursor..]);
        result = out;
    }
    result
}

/// Decode the handful of HTML entities Apple Notes emits.
fn decode_entities(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(idx) = rest.find('&') {
        out.push_str(&rest[..idx]);
        let tail = &rest[idx..];
        if let Some(semi) = tail.find(';').filter(|semi| *semi <= 10) {
            let entity = &tail[1..semi];
            let decoded = match entity {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" | "#39" => Some('\''),
                "nbsp" => Some(' '),
                _ => decode_numeric_entity(entity),
            };
            if let Some(ch) = decoded {
                out.push(ch);
                rest = &tail[semi + 1..];
                continue;
            }
        }
        out.push('&');
        rest = &tail[1..];
    }
    out.push_str(rest);
    out
}

fn decode_numeric_entity(entity: &str) -> Option<char> {
    let code = if let Some(hex) = entity
        .strip_prefix("#x")
        .or_else(|| entity.strip_prefix("#X"))
    {
        u32::from_str_radix(hex, 16).ok()?
    } else if let Some(dec) = entity.strip_prefix('#') {
        dec.parse::<u32>().ok()?
    } else {
        return None;
    };
    char::from_u32(code)
}

/// Trim trailing spaces and collapse runs of blank lines down to one.
fn collapse_whitespace(input: &str) -> String {
    let mut lines: Vec<String> = input
        .replace('\r', "")
        .split('\n')
        .map(|line| line.trim_end().to_string())
        .collect();
    // Collapse 2+ consecutive blank lines into a single blank line.
    let mut collapsed: Vec<String> = Vec::with_capacity(lines.len());
    let mut blank_run = false;
    for line in lines.drain(..) {
        if line.is_empty() {
            if !blank_run {
                collapsed.push(line);
            }
            blank_run = true;
        } else {
            collapsed.push(line);
            blank_run = false;
        }
    }
    collapsed.join("\n").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_epoch_seconds_and_millis() {
        assert_eq!(parse_date_value("1700000000"), Some(1_700_000_000_000));
        assert_eq!(parse_date_value("1700000000000"), Some(1_700_000_000_000));
    }

    #[test]
    fn parses_rfc3339_and_date_only() {
        assert_eq!(
            parse_date_value("2023-11-14T22:13:20Z"),
            Some(1_700_000_000_000)
        );
        // Date-only resolves to UTC midnight.
        assert_eq!(parse_date_value("2021-01-01"), Some(1_609_459_200_000));
    }

    #[test]
    fn front_matter_split_extracts_date_and_strips_block() {
        let raw = "---\ntitle: Hello\ncreated: 2021-01-01\n---\n\n# Hello\n\nBody text";
        let (date, body) = split_front_matter(raw);
        assert_eq!(date, Some(1_609_459_200_000));
        assert_eq!(body, "# Hello\n\nBody text");
    }

    #[test]
    fn lone_triple_dash_is_kept_as_body() {
        let raw = "--- not front matter\nstill body";
        let (date, body) = split_front_matter(raw);
        assert_eq!(date, None);
        assert_eq!(body, raw);
    }

    #[test]
    fn html_converts_headings_breaks_and_emphasis() {
        let html = "<h1>Title</h1><p>Hello <b>bold</b> and <i>italic</i></p><br>line2";
        let md = html_to_markdown(html);
        assert!(md.starts_with("# Title"));
        assert!(md.contains("**bold**"));
        assert!(md.contains("*italic*"));
        assert!(md.contains("line2"));
    }

    #[test]
    fn html_rewrites_links_and_decodes_entities() {
        let html = r#"<p>See <a href="https://x.test">site</a> &amp; more</p>"#;
        let md = html_to_markdown(html);
        assert!(md.contains("[site](https://x.test)"));
        assert!(md.contains("& more"));
    }

    #[test]
    fn sanitize_segment_strips_separators_and_dots() {
        assert_eq!(sanitize_segment("a/b:c"), "a b c");
        assert_eq!(sanitize_segment("  .. "), "");
        assert_eq!(sanitize_segment("Work Notes"), "Work Notes");
    }
}
