use serde::{Deserialize, Serialize};

/// A note's display name and relative path.
#[derive(Serialize)]
pub struct NoteEntry {
    pub name: String,
    pub path: String,
}

/// Metadata returned to the frontend for a single note.
#[derive(Serialize)]
pub struct NoteMeta {
    pub created_ms: Option<i64>,
    pub updated_ms: Option<i64>,
    pub note_type: Option<String>,
    pub archived_ms: Option<i64>,
    pub reviewed_ms: Option<i64>,
    pub recording_audio_path: Option<String>,
    pub handwriting_attachment_path: Option<String>,
    pub transcription_status: Option<String>,
    pub transcription_error: Option<String>,
    pub transcription_updated_ms: Option<i64>,
    pub ocr_status: Option<String>,
    pub ocr_error: Option<String>,
    pub ocr_updated_ms: Option<i64>,
}

/// YAML-ish front-matter fields stored at the top of each markdown note.
#[derive(Default)]
pub struct NoteFrontMatter {
    pub id: Option<String>,
    pub created_ms: Option<i64>,
    pub updated_ms: Option<i64>,
    pub note_type: Option<String>,
    pub archived_ms: Option<i64>,
    pub reviewed_ms: Option<i64>,
    pub recording_audio_path: Option<String>,
    pub handwriting_attachment_path: Option<String>,
    pub transcription_status: Option<String>,
    pub transcription_error: Option<String>,
    pub transcription_updated_ms: Option<i64>,
    pub transcription_id: Option<String>,
    pub ocr_status: Option<String>,
    pub ocr_error: Option<String>,
    pub ocr_updated_ms: Option<i64>,
    pub passthrough_lines: Vec<String>,
}

/// Arguments for setting folder and note ordering within a parent.
#[derive(Deserialize)]
pub struct SetOrderArgs {
    pub parent: String,
    #[serde(rename = "folderOrder")]
    pub folder_order: Vec<String>,
    #[serde(rename = "noteOrder")]
    pub note_order: Vec<String>,
}

/// Arguments for updating a note's created timestamp.
#[derive(Deserialize)]
pub struct SetNoteTimestampArgs {
    pub path: String,
    pub timestamp_ms: i64,
}

/// Arguments for updating feed-related note markers.
#[derive(Deserialize)]
pub struct SetNoteMarkersArgs {
    pub path: String,
    pub archived: Option<bool>,
    pub reviewed: Option<bool>,
}

/// Recursive tree node representing a folder with child folders and notes.
#[derive(Serialize)]
pub struct FolderNode {
    pub name: String,
    pub path: String,
    pub children: Vec<FolderNode>,
    pub notes: Vec<NoteEntry>,
}

/// Persisted sort order for folders and notes within a directory.
#[derive(Default, Deserialize, Serialize)]
pub struct OrderFile {
    #[serde(default)]
    pub folder_order: Vec<String>,
    #[serde(default)]
    pub note_order: Vec<String>,
}

/// Filename format strategy for new notes.
#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteFileNameFormat {
    #[default]
    UtcTimestampSlug,
    UuidV7,
    UuidV7PrefixSlug,
}

/// Arguments for creating a new note.
#[derive(Deserialize)]
pub struct CreateNoteArgs {
    pub folder_path: Option<String>,
    pub content: Option<String>,
    pub timestamp_ms: Option<i64>,
    #[serde(default)]
    pub file_name_format: NoteFileNameFormat,
}

/// Result returned after creating a note, containing its relative path.
#[derive(Serialize)]
pub struct CreateNoteResult {
    pub path: String,
}
