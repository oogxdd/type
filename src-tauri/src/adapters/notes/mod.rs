//! Notes filesystem: folder tree, front-matter parsing, ordering, system folders.
//!
//! Split into focused submodules. This hub holds the shared constants and DTO
//! types plus root/path resolution, then re-exports each submodule so the
//! crate-root notes::* surface is unchanged.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use crate::{ensure_profiles_state, find_profile};

mod front_matter;
mod naming;
mod tree;

pub(crate) use front_matter::*;
pub(crate) use naming::*;
pub(crate) use tree::*;

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
