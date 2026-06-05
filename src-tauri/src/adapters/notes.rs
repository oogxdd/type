//! Notes filesystem: folder tree, front-matter parsing, ordering, system folders.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Component, Path, PathBuf},
};
use time::{macros::format_description, Duration as TimeDuration, OffsetDateTime};
use uuid::Uuid;

use crate::{encrypt_note_body_for_write, ensure_profiles_state, find_profile, time_to_ms};

// ── Constants ──────────────────────────────────────────────────────────────────

pub(crate) const ORDER_FILE: &str = ".notes-order.json";
pub(crate) const FEED_FOLDER: &str = "Feed";
pub(crate) const ARCHIEVE_FOLDER: &str = "Archieve";
const LEGACY_UNSORTED_FOLDER: &str = "Unsorted";
pub(crate) const RECORDINGS_STORAGE_FOLDER: &str = "Recordings";
pub(crate) const ATTACHMENTS_STORAGE_FOLDER: &str = "Attachments";
pub(crate) const LEGACY_RECORDINGS_FOLDER: &str = "_Recordings";

const VISIBLE_SYSTEM_FOLDERS: [&str; 2] = [FEED_FOLDER, ARCHIEVE_FOLDER];
const REQUIRED_SYSTEM_FOLDERS: [&str; 4] = [
    FEED_FOLDER,
    ARCHIEVE_FOLDER,
    ATTACHMENTS_STORAGE_FOLDER,
    RECORDINGS_STORAGE_FOLDER,
];
pub(crate) const PROTECTED_SYSTEM_FOLDERS: [&str; 6] = [
    FEED_FOLDER,
    ARCHIEVE_FOLDER,
    LEGACY_UNSORTED_FOLDER,
    ATTACHMENTS_STORAGE_FOLDER,
    RECORDINGS_STORAGE_FOLDER,
    LEGACY_RECORDINGS_FOLDER,
];
const HIDDEN_ROOT_FOLDERS: [&str; 3] = [
    ATTACHMENTS_STORAGE_FOLDER,
    RECORDINGS_STORAGE_FOLDER,
    LEGACY_RECORDINGS_FOLDER,
];

// ── Types ──────────────────────────────────────────────────────────────────────

/// A note's display name and relative path.
#[derive(Serialize)]
pub(crate) struct NoteEntry {
    pub(crate) name: String,
    pub(crate) path: String,
}

/// Metadata returned to the frontend for a single note.
#[derive(Serialize)]
pub(crate) struct NoteMeta {
    pub(crate) created_ms: Option<i64>,
    pub(crate) updated_ms: Option<i64>,
    pub(crate) note_type: Option<String>,
    pub(crate) recording_audio_path: Option<String>,
    pub(crate) handwriting_attachment_path: Option<String>,
    pub(crate) transcription_status: Option<String>,
    pub(crate) transcription_error: Option<String>,
    pub(crate) transcription_updated_ms: Option<i64>,
    pub(crate) ocr_status: Option<String>,
    pub(crate) ocr_error: Option<String>,
    pub(crate) ocr_updated_ms: Option<i64>,
}

/// YAML-ish front-matter fields stored at the top of each markdown note.
#[derive(Default)]
pub(crate) struct NoteFrontMatter {
    pub(crate) id: Option<String>,
    pub(crate) created_ms: Option<i64>,
    pub(crate) updated_ms: Option<i64>,
    pub(crate) note_type: Option<String>,
    pub(crate) recording_audio_path: Option<String>,
    pub(crate) handwriting_attachment_path: Option<String>,
    pub(crate) transcription_status: Option<String>,
    pub(crate) transcription_error: Option<String>,
    pub(crate) transcription_updated_ms: Option<i64>,
    pub(crate) transcription_id: Option<String>,
    pub(crate) ocr_status: Option<String>,
    pub(crate) ocr_error: Option<String>,
    pub(crate) ocr_updated_ms: Option<i64>,
    pub(crate) passthrough_lines: Vec<String>,
}

/// Arguments for setting folder and note ordering within a parent.
#[derive(Deserialize)]
pub(crate) struct SetOrderArgs {
    pub(crate) parent: String,
    #[serde(rename = "folderOrder")]
    pub(crate) folder_order: Vec<String>,
    #[serde(rename = "noteOrder")]
    pub(crate) note_order: Vec<String>,
}

/// Arguments for updating a note's created timestamp.
#[derive(Deserialize)]
pub(crate) struct SetNoteTimestampArgs {
    pub(crate) path: String,
    pub(crate) timestamp_ms: i64,
}

/// Recursive tree node representing a folder with child folders and notes.
#[derive(Serialize)]
pub(crate) struct FolderNode {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) children: Vec<FolderNode>,
    pub(crate) notes: Vec<NoteEntry>,
}

/// Persisted sort order for folders and notes within a directory.
#[derive(Default, Deserialize, Serialize)]
pub(crate) struct OrderFile {
    #[serde(default)]
    pub(crate) folder_order: Vec<String>,
    #[serde(default)]
    pub(crate) note_order: Vec<String>,
}

/// Filename format strategy for new notes.
#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum NoteFileNameFormat {
    #[default]
    UtcTimestampSlug,
    UuidV7,
    UuidV7PrefixSlug,
}

/// Arguments for creating a new note.
#[derive(Deserialize)]
pub(crate) struct CreateNoteArgs {
    pub(crate) folder_path: Option<String>,
    pub(crate) content: Option<String>,
    pub(crate) timestamp_ms: Option<i64>,
    #[serde(default)]
    pub(crate) file_name_format: NoteFileNameFormat,
}

/// Result returned after creating a note, containing its relative path.
#[derive(Serialize)]
pub(crate) struct CreateNoteResult {
    pub(crate) path: String,
}

// ── Root resolution ────────────────────────────────────────────────────────────

/// Resolve the active profile's notes root, creating the directory if needed.
pub(crate) fn notes_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = match ensure_profiles_state(app) {
        Ok(state) => {
            let active = find_profile(&state, &state.active_profile_id)
                .or_else(|| state.profiles.first())
                .ok_or_else(|| "No profiles configured.".to_string())?;
            PathBuf::from(&active.notes_root)
        }
        Err(_) => crate::legacy_notes_root(app)?,
    };
    if !root.exists() {
        fs::create_dir_all(&root).map_err(|err| err.to_string())?;
    }
    Ok(root)
}

/// Notes root with system folders guaranteed to exist.
pub(crate) fn ensured_notes_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = notes_root(app)?;
    ensure_system_folders(&root)?;
    Ok(root)
}

// ── Path helpers ───────────────────────────────────────────────────────────────

/// Reject absolute paths and parent-dir traversals.
pub(crate) fn sanitize_relative(path: &str) -> Result<PathBuf, String> {
    if path.is_empty() {
        return Ok(PathBuf::new());
    }
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err("Absolute paths are not allowed.".to_string());
    }
    for component in candidate.components() {
        match component {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Invalid path traversal.".to_string())
            }
            _ => {}
        }
    }
    Ok(candidate.to_path_buf())
}

/// Join a sanitized relative path onto the notes root.
pub(crate) fn resolve_path(app: &tauri::AppHandle, rel: &str) -> Result<PathBuf, String> {
    let root = notes_root(app)?;
    let rel_path = sanitize_relative(rel)?;
    Ok(root.join(rel_path))
}

/// Strip the notes root prefix, returning a forward-slash relative path.
pub(crate) fn strip_root(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

// ── Front-matter parsing ───────────────────────────────────────────────────────

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

// ── Note ID & filename generation ──────────────────────────────────────────────

/// Generate a new UUIDv7-based note identifier.
pub(crate) fn generate_note_id() -> String {
    Uuid::now_v7().to_string()
}

/// Extract the trailing portion of a UUID (after the timestamp segments).
pub(crate) fn uuid_tail_without_timestamp_prefix(note_id: &str) -> String {
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
pub(crate) fn slug_from_content(content: &str, fallback: &str) -> String {
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
pub(crate) fn allocate_prefixed_note_file_name(
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
pub(crate) fn allocate_uuid_v7_note_file_name(
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
pub(crate) fn allocate_note_file_name(
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

// ── File collection ────────────────────────────────────────────────────────────

/// Recursively collect all `.md` files, skipping hidden and storage folders.
pub(crate) fn collect_markdown_note_files(
    root: &Path,
    dir: &Path,
    files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ORDER_FILE {
            continue;
        }
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if metadata.is_dir() {
            if name.starts_with('.') {
                continue;
            }
            if dir == root {
                if HIDDEN_ROOT_FOLDERS.iter().any(|hidden| *hidden == name) {
                    continue;
                }
            }
            collect_markdown_note_files(root, &path, files)?;
            continue;
        }
        if metadata.is_file() && path.extension().and_then(|value| value.to_str()) == Some("md") {
            files.push(path);
        }
    }
    Ok(())
}

// ── Ordering & sorting ─────────────────────────────────────────────────────────

/// Sort names according to a persisted order list, alphabetical fallback.
pub(crate) fn sort_by_order(mut names: Vec<String>, order: &[String]) -> Vec<String> {
    let mut index = HashMap::new();
    for (idx, name) in order.iter().enumerate() {
        index.insert(name, idx);
    }
    names.sort_by(|a, b| {
        let a_idx = index.get(a).copied().unwrap_or(usize::MAX);
        let b_idx = index.get(b).copied().unwrap_or(usize::MAX);
        a_idx
            .cmp(&b_idx)
            .then_with(|| a.to_lowercase().cmp(&b.to_lowercase()))
    });
    names
}

// ── Folder classification ──────────────────────────────────────────────────────

/// True if the folder name matches a protected system folder.
pub(crate) fn is_system_folder_name(name: &str) -> bool {
    PROTECTED_SYSTEM_FOLDERS
        .iter()
        .any(|folder| *folder == name)
}

/// True if the folder should be hidden from the tree at root level.
pub(crate) fn is_hidden_root_folder_name(name: &str) -> bool {
    HIDDEN_ROOT_FOLDERS.iter().any(|folder| *folder == name)
}

/// True if the path is the Feed folder.
pub(crate) fn is_feed_folder_path(root: &Path, path: &Path) -> bool {
    path == root.join(FEED_FOLDER)
}

/// Extract created_ms for Feed sort order (front-matter → fs metadata → 0).
fn note_created_ms_for_sort(path: &Path) -> i64 {
    if let Ok(raw) = fs::read_to_string(path) {
        let (meta, _) = parse_note_front_matter(&raw);
        if let Some(created_ms) = meta.created_ms {
            return created_ms;
        }
    }
    if let Ok(metadata) = fs::metadata(path) {
        if let Ok(created) = metadata.created() {
            if let Some(created_ms) = time_to_ms(created) {
                return created_ms;
            }
        }
        if let Ok(modified) = metadata.modified() {
            if let Some(modified_ms) = time_to_ms(modified) {
                return modified_ms;
            }
        }
    }
    0
}

// ── Legacy migration ───────────────────────────────────────────────────────────

fn migrate_legacy_folder_name(root: &Path, from_name: &str, to_name: &str) -> Result<(), String> {
    let from = root.join(from_name);
    if !from.exists() {
        return Ok(());
    }
    let to = root.join(to_name);
    if !to.exists() {
        fs::rename(&from, &to).map_err(|err| err.to_string())?;
        return Ok(());
    }
    for entry in fs::read_dir(&from).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        if target.exists() {
            continue;
        }
        fs::rename(&source, &target).map_err(|err| err.to_string())?;
    }
    fs::remove_dir_all(&from).map_err(|err| err.to_string())?;
    Ok(())
}

fn migrate_legacy_system_folders(root: &Path) -> Result<(), String> {
    migrate_legacy_folder_name(root, LEGACY_UNSORTED_FOLDER, FEED_FOLDER)?;
    migrate_legacy_folder_name(root, LEGACY_RECORDINGS_FOLDER, RECORDINGS_STORAGE_FOLDER)?;
    let feed_order = root.join(FEED_FOLDER).join(ORDER_FILE);
    if feed_order.exists() {
        let _ = fs::remove_file(feed_order);
    }
    Ok(())
}

// ── System folders ─────────────────────────────────────────────────────────────

/// True if the path is a direct child of root and a system folder.
pub(crate) fn is_system_folder_path(root: &Path, path: &Path) -> bool {
    if path.parent() != Some(root) {
        return false;
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(is_system_folder_name)
}

/// Check if a path falls inside a storage folder (recordings/attachments).
pub(crate) fn is_storage_folder_path(root: &Path, path: &Path) -> bool {
    path.starts_with(root.join(RECORDINGS_STORAGE_FOLDER))
        || path.starts_with(root.join(LEGACY_RECORDINGS_FOLDER))
        || path.starts_with(root.join(ATTACHMENTS_STORAGE_FOLDER))
}

/// Create required system folders and ensure visible ones appear in the order file.
pub(crate) fn ensure_system_folders(root: &Path) -> Result<(), String> {
    migrate_legacy_system_folders(root)?;

    for folder in REQUIRED_SYSTEM_FOLDERS {
        let path = root.join(folder);
        if path.exists() {
            continue;
        }
        fs::create_dir_all(&path).map_err(|err| {
            format!(
                "Failed to create system folder {}: {}",
                path.to_string_lossy(),
                err
            )
        })?;
    }

    let mut order = read_order_file(root);
    let mut changed = false;
    for folder in VISIBLE_SYSTEM_FOLDERS {
        if !order.folder_order.iter().any(|name| name == folder) {
            order.folder_order.push(folder.to_string());
            changed = true;
        }
    }

    if changed {
        write_order_file(root, &order)?;
    }

    Ok(())
}

// ── Folder tree ────────────────────────────────────────────────────────────────

/// Recursively build the folder/note tree for the frontend sidebar.
pub(crate) fn build_folder_node(dir: &Path, rel_path: &str) -> Result<FolderNode, String> {
    let order = read_order_file(dir);
    let mut folders = Vec::new();
    let mut notes = Vec::new();

    for entry in fs::read_dir(dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ORDER_FILE {
            continue;
        }
        if rel_path.is_empty() && is_hidden_root_folder_name(&name) {
            continue;
        }
        let meta = entry.metadata().map_err(|err| err.to_string())?;
        if meta.is_dir() {
            folders.push(name);
        } else if meta.is_file() {
            if path.extension().and_then(|ext| ext.to_str()) == Some("md") {
                notes.push(name);
            }
        }
    }

    let folder_names = sort_by_order(folders, &order.folder_order);
    let note_names = if rel_path == FEED_FOLDER {
        // Feed folder: sort by newest-first created timestamp.
        let mut feed_notes = notes
            .into_iter()
            .map(|name| {
                let created_ms = note_created_ms_for_sort(&dir.join(&name));
                (name, created_ms)
            })
            .collect::<Vec<_>>();
        feed_notes.sort_by(|(a_name, a_created), (b_name, b_created)| {
            b_created
                .cmp(a_created)
                .then_with(|| a_name.to_lowercase().cmp(&b_name.to_lowercase()))
        });
        feed_notes.into_iter().map(|(name, _)| name).collect()
    } else {
        sort_by_order(notes, &order.note_order)
    };

    let mut children = Vec::new();
    for name in folder_names {
        let child_path = dir.join(&name);
        let child_rel = if rel_path.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel_path, name)
        };
        children.push(build_folder_node(&child_path, &child_rel)?);
    }

    let mut note_entries = Vec::new();
    for name in note_names {
        let note_rel = if rel_path.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel_path, name)
        };
        note_entries.push(NoteEntry {
            name,
            path: note_rel,
        });
    }

    Ok(FolderNode {
        name: if rel_path.is_empty() {
            "Notes".to_string()
        } else {
            dir.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Folder")
                .to_string()
        },
        path: rel_path.to_string(),
        children,
        notes: note_entries,
    })
}

// ── Order file I/O ─────────────────────────────────────────────────────────────

/// Read the `.notes-order.json` from a directory, returning defaults if missing.
pub(crate) fn read_order_file(dir: &Path) -> OrderFile {
    let file_path = dir.join(ORDER_FILE);
    if let Ok(contents) = fs::read_to_string(file_path) {
        if let Ok(order) = serde_json::from_str::<OrderFile>(&contents) {
            return order;
        }
    }
    OrderFile::default()
}

/// Persist the order file to disk (no-op for Feed folder, which sorts by date).
pub(crate) fn write_order_file(dir: &Path, order: &OrderFile) -> Result<(), String> {
    if dir
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == FEED_FOLDER)
    {
        return Ok(());
    }
    let file_path = dir.join(ORDER_FILE);
    let contents = serde_json::to_string_pretty(order).map_err(|err| err.to_string())?;
    fs::write(file_path, contents).map_err(|err| err.to_string())
}

/// Remove entries from the folder or note order list.
pub(crate) fn update_order_remove(
    dir: &Path,
    names: &[String],
    is_folder: bool,
) -> Result<(), String> {
    let mut order = read_order_file(dir);
    if is_folder {
        order.folder_order.retain(|name| !names.contains(name));
    } else {
        order.note_order.retain(|name| !names.contains(name));
    }
    write_order_file(dir, &order)
}

/// Append entries to the folder or note order list if not already present.
pub(crate) fn update_order_append(
    dir: &Path,
    names: &[String],
    is_folder: bool,
) -> Result<(), String> {
    let mut order = read_order_file(dir);
    let list = if is_folder {
        &mut order.folder_order
    } else {
        &mut order.note_order
    };
    for name in names {
        if !list.contains(name) {
            list.push(name.clone());
        }
    }
    write_order_file(dir, &order)
}

/// Rename an entry in the order list (preserving its position).
pub(crate) fn update_order_rename(
    dir: &Path,
    old_name: &str,
    new_name: &str,
    is_folder: bool,
) -> Result<(), String> {
    let mut order = read_order_file(dir);
    let list = if is_folder {
        &mut order.folder_order
    } else {
        &mut order.note_order
    };
    if let Some(pos) = list.iter().position(|item| item == old_name) {
        list[pos] = new_name.to_string();
    }
    write_order_file(dir, &order)
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
