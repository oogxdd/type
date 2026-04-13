use serde::{Deserialize, Serialize};

// ── Types ──────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct NoteEntry {
    pub name: String,
    pub path: String,
}

#[derive(Serialize)]
pub struct NoteMeta {
    pub created_ms: Option<i64>,
    pub updated_ms: Option<i64>,
    pub note_type: Option<String>,
    pub recording_audio_path: Option<String>,
    pub handwriting_attachment_path: Option<String>,
    pub transcription_status: Option<String>,
    pub transcription_error: Option<String>,
    pub transcription_updated_ms: Option<i64>,
    pub ocr_status: Option<String>,
    pub ocr_error: Option<String>,
    pub ocr_updated_ms: Option<i64>,
}

#[derive(Serialize)]
pub struct FolderNode {
    pub name: String,
    pub path: String,
    pub children: Vec<FolderNode>,
    pub notes: Vec<NoteEntry>,
}

#[derive(Serialize)]
pub struct CreateNoteResult {
    pub path: String,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteFileNameFormat {
    #[default]
    UtcTimestampSlug,
    UuidV7,
    UuidV7PrefixSlug,
}

// ── Trait ──────────────────────────────────────────────────────────────────────

pub trait NoteService {
    fn get_tree(&self) -> Result<FolderNode, String>;
    fn read_note(&self, path: &str) -> Result<String, String>;
    fn create_note(&self, folder_path: Option<&str>, content: Option<&str>, timestamp_ms: Option<i64>, file_name_format: NoteFileNameFormat) -> Result<CreateNoteResult, String>;
    fn write_note(&self, path: &str, content: &str) -> Result<(), String>;
    fn set_note_timestamp(&self, path: &str, timestamp_ms: i64) -> Result<(), String>;
    fn get_note_meta(&self, path: &str) -> Result<NoteMeta, String>;
    fn move_items(&self, items: &[String], destination: &str) -> Result<(), String>;
    fn delete_items(&self, items: &[String]) -> Result<(), String>;
    fn rename_item(&self, path: &str, new_name: &str) -> Result<String, String>;
    fn set_order(&self, parent: &str, folder_order: Vec<String>, note_order: Vec<String>) -> Result<(), String>;
}

// ─── Implementation Notes ─────────────────────────────────────────────────────
//
// NoteService manages notes stored as markdown files with YAML-ish front-matter.
//
// get_tree()
//   in:  nothing
//   out: FolderNode — the full folder hierarchy from the notes root
//   - Hidden storage folders (Recordings/, Attachments/) are excluded from the tree
//   - Each folder contains its child folders and the notes inside it
//   - Folders are sorted by a persisted order file (.notes-order.json), alphabetical fallback
//   - The "Feed" folder sorts notes by newest-first created timestamp instead
//
// read_note(path)
//   in:  path — relative to notes root, e.g. "Feed/my-note.md"
//   out: String — the note body text (markdown)
//   - Parses front-matter but only returns the body
//   - If encryption is active, the body must be decrypted transparently
//   - The caller never sees ciphertext
//
// create_note(folder_path, content, timestamp_ms, file_name_format)
//   in:  folder_path — where to create it, defaults to "Feed"
//        content — initial body text, defaults to empty
//        timestamp_ms — creation time in unix ms, defaults to now
//        file_name_format — how to name the file (timestamp slug, uuid, or uuid-prefix slug)
//   out: CreateNoteResult — contains the relative path of the created file
//   - Generates a UUID v7 id and populates front-matter automatically
//   - Must encrypt body if encryption is active
//   - Cannot create notes inside storage folders (Recordings/, Attachments/)
//
// write_note(path, content)
//   in:  path — relative path to the note
//        content — new body text (replaces existing)
//   out: nothing
//   - Preserves existing front-matter, only replaces the body
//   - Updates the updated_ms timestamp
//   - Must encrypt if encryption is active
//
// set_note_timestamp(path, timestamp_ms)
//   in:  path — relative path to the note
//        timestamp_ms — new timestamp in unix ms
//   out: nothing
//   - Updates created_ms if the new value is earlier, always updates updated_ms
//   - Preserves the note body
//
// get_note_meta(path)
//   in:  path — relative path to the note
//   out: NoteMeta — timestamps, type, recording/handwriting paths, transcription/ocr status
//   - Falls back to git history timestamps if front-matter has no timestamps
//   - Falls back to filesystem timestamps if git has no history
//
// move_items(items, destination)
//   in:  items — list of relative paths (notes or folders)
//        destination — relative path to target folder
//   out: nothing
//   - Cannot move system folders (Feed, Archieve, Recordings, Attachments)
//   - Updates ordering files in both source and destination folders
//
// delete_items(items)
//   in:  items — list of relative paths (notes or folders)
//   out: nothing
//   - Deletes recursively for folders
//   - Cannot delete system folders
//   - Permanent — no trash/undo
//
// rename_item(path, new_name)
//   in:  path — relative path to the item
//        new_name — the new filename or folder name
//   out: String — the new relative path after rename
//   - Cannot rename system folders
//   - Updates ordering files
//
// set_order(parent, folder_order, note_order)
//   in:  parent — relative path to the folder
//        folder_order — ordered list of subfolder names
//        note_order — ordered list of note filenames
//   out: nothing
//   - Persists to .notes-order.json inside the folder
//   - Feed folder ignores custom order (always sorted by timestamp)
//
// Key assumptions for any implementation:
//   - Paths are always relative to a "notes root" directory
//   - Notes are markdown files with YAML-ish front-matter (--- delimited)
//   - Front-matter fields: id, created_ms, updated_ms, type, plus domain-specific fields
//   - Encryption is transparent: encrypt on write, decrypt on read
//   - The note ID is a UUID v7 string, generated once at creation
//   - Timestamps are Unix milliseconds
//   - System folders (Feed, Archieve, Recordings, Attachments) are protected from move/delete/rename
