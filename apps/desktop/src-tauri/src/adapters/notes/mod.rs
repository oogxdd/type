//! Notes filesystem: folder tree, front-matter parsing, ordering, system folders.
//!
//! Split into focused submodules. This hub holds filesystem root/path
//! resolution, then re-exports each submodule so the crate-root notes::* surface
//! is unchanged.

use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use crate::ports::notes::{
    NoteBodyCrypto, NoteClock, NoteDocumentCodec, NoteIdGenerator, NoteStorageEntryKind,
    NotesRepository,
};
use crate::{
    ensure_profiles_state, find_profile, FolderNode, NoteEntry, NoteFileNameFormat,
    NoteFrontMatter, OrderFile,
};

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

pub(crate) struct FilesystemNotesRepository {
    root: PathBuf,
}

impl FilesystemNotesRepository {
    pub(crate) fn new(root: PathBuf) -> Self {
        Self { root }
    }
}

impl NotesRepository for FilesystemNotesRepository {
    fn ensured_root(&self) -> Result<PathBuf, String> {
        if !self.root.exists() {
            fs::create_dir_all(&self.root).map_err(|err| err.to_string())?;
        }
        ensure_system_folders(&self.root)?;
        Ok(self.root.clone())
    }

    fn resolve_path(&self, rel: &str) -> Result<PathBuf, String> {
        let rel_path = sanitize_relative(rel)?;
        Ok(self.root.join(rel_path))
    }

    fn strip_root(&self, path: &Path) -> String {
        strip_root(&self.root, path)
    }

    fn build_tree(&self) -> Result<FolderNode, String> {
        build_folder_node(&self.root, "")
    }

    fn read_to_string(&self, path: &Path) -> Result<String, String> {
        fs::read_to_string(path).map_err(|err| err.to_string())
    }

    fn entry_kind(&self, path: &Path) -> Result<Option<NoteStorageEntryKind>, String> {
        let metadata = match fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        let kind = if metadata.is_file() {
            NoteStorageEntryKind::File
        } else if metadata.is_dir() {
            NoteStorageEntryKind::Directory
        } else {
            NoteStorageEntryKind::Other
        };
        Ok(Some(kind))
    }

    fn file_times(
        &self,
        path: &Path,
    ) -> Result<(Option<std::time::SystemTime>, Option<std::time::SystemTime>), String> {
        let metadata = fs::metadata(path).map_err(|err| err.to_string())?;
        Ok((metadata.created().ok(), metadata.modified().ok()))
    }

    fn create_dir_all(&self, path: &Path) -> Result<(), String> {
        fs::create_dir_all(path).map_err(|err| err.to_string())
    }

    fn rename(&self, source: &Path, target: &Path) -> Result<(), String> {
        fs::rename(source, target).map_err(|err| err.to_string())
    }

    fn remove_dir_all(&self, path: &Path) -> Result<(), String> {
        fs::remove_dir_all(path).map_err(|err| err.to_string())
    }

    fn remove_file(&self, path: &Path) -> Result<(), String> {
        fs::remove_file(path).map_err(|err| err.to_string())
    }

    fn write_note(&self, path: &Path, meta: &NoteFrontMatter, body: &str) -> Result<(), String> {
        write_note_with_front_matter(path, meta, body)
    }

    fn allocate_note_file_name(
        &self,
        folder: &Path,
        timestamp_ms: i64,
        note_id: &str,
        content: &str,
        fallback_slug: &str,
        file_name_format: NoteFileNameFormat,
    ) -> Result<String, String> {
        allocate_note_file_name(
            folder,
            timestamp_ms,
            note_id,
            content,
            fallback_slug,
            file_name_format,
        )
    }

    fn is_feed_folder_path(&self, path: &Path) -> bool {
        is_feed_folder_path(&self.root, path)
    }

    fn is_storage_folder_path(&self, path: &Path) -> bool {
        is_storage_folder_path(&self.root, path)
    }

    fn is_system_folder_path(&self, path: &Path) -> bool {
        is_system_folder_path(&self.root, path)
    }

    fn update_order_append(
        &self,
        dir: &Path,
        names: &[String],
        is_folder: bool,
    ) -> Result<(), String> {
        update_order_append(dir, names, is_folder)
    }

    fn update_order_remove(
        &self,
        dir: &Path,
        names: &[String],
        is_folder: bool,
    ) -> Result<(), String> {
        update_order_remove(dir, names, is_folder)
    }

    fn update_order_rename(
        &self,
        dir: &Path,
        old_name: &str,
        new_name: &str,
        is_folder: bool,
    ) -> Result<(), String> {
        update_order_rename(dir, old_name, new_name, is_folder)
    }

    fn write_order_file(&self, dir: &Path, order: &OrderFile) -> Result<(), String> {
        write_order_file(dir, order)
    }
}

pub(crate) struct FrontMatterNoteDocumentCodec;

impl NoteDocumentCodec for FrontMatterNoteDocumentCodec {
    fn parse(&self, raw: &str) -> (NoteFrontMatter, String) {
        parse_note_front_matter(raw)
    }
}

pub(crate) struct RuntimeNoteBodyCrypto;

impl NoteBodyCrypto for RuntimeNoteBodyCrypto {
    fn decrypt_note_body(&self, body: &str) -> Result<String, String> {
        crate::decrypt_note_body_for_read(body)
    }
}

pub(crate) struct UuidNoteIdGenerator;

impl NoteIdGenerator for UuidNoteIdGenerator {
    fn generate_note_id(&self) -> String {
        generate_note_id()
    }

    fn uuid_tail_without_timestamp_prefix(&self, note_id: &str) -> String {
        uuid_tail_without_timestamp_prefix(note_id)
    }
}

pub(crate) struct SystemNoteClock;

impl NoteClock for SystemNoteClock {
    fn now_ms(&self) -> Option<i64> {
        crate::now_ms()
    }

    fn time_to_ms(&self, time: std::time::SystemTime) -> Option<i64> {
        crate::time_to_ms(time)
    }
}
