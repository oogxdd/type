use std::{collections::HashMap, path::PathBuf};

use crate::{
    ports::notes::{
        NoteBodyCrypto, NoteClock, NoteDocumentCodec, NoteIdGenerator, NoteStorageEntryKind,
        NotesRepository,
    },
    CreateNoteArgs, CreateNoteResult, FolderNode, NoteFrontMatter, NoteMeta, NotePreviewEntry,
    OrderFile, SetNoteTimestampArgs, SetOrderArgs, FEED_FOLDER,
};

/// Note use cases. This layer owns workflow and policy while persistence,
/// document parsing, encryption, IDs, and time are supplied as ports.
pub struct NotesService<R, D, C, I, T> {
    repository: R,
    documents: D,
    crypto: C,
    ids: I,
    clock: T,
}

impl<R, D, C, I, T> NotesService<R, D, C, I, T>
where
    R: NotesRepository,
    D: NoteDocumentCodec,
    C: NoteBodyCrypto,
    I: NoteIdGenerator,
    T: NoteClock,
{
    pub fn new(repository: R, documents: D, crypto: C, ids: I, clock: T) -> Self {
        Self {
            repository,
            documents,
            crypto,
            ids,
            clock,
        }
    }

    pub fn get_tree(&self) -> Result<FolderNode, String> {
        self.repository.ensured_root()?;
        self.repository.build_tree()
    }

    pub fn read_note(&self, path: &str) -> Result<String, String> {
        let full_path = self.repository.resolve_path(path)?;
        if self.repository.entry_kind(&full_path)? != Some(NoteStorageEntryKind::File) {
            return Err("Note file does not exist.".to_string());
        }
        let raw = self.repository.read_to_string(&full_path)?;
        let (_, body) = self.documents.parse(&raw);
        self.crypto.decrypt_note_body(&body)
    }

    pub fn create_note(&self, args: CreateNoteArgs) -> Result<CreateNoteResult, String> {
        self.repository.ensured_root()?;
        let folder_rel = args
            .folder_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(FEED_FOLDER);
        let folder_full = self.repository.resolve_path(folder_rel)?;
        if self.repository.is_storage_folder_path(&folder_full) {
            return Err(
                "Notes cannot be created inside recordings or attachments storage.".to_string(),
            );
        }
        self.repository.create_dir_all(&folder_full)?;

        let timestamp = args
            .timestamp_ms
            .or_else(|| self.clock.now_ms())
            .unwrap_or(0);
        let content = args.content.unwrap_or_default();
        let note_id = self.ids.generate_note_id();
        let fallback = format!(
            "note-{}",
            self.ids.uuid_tail_without_timestamp_prefix(&note_id)
        );
        let file_name = self.repository.allocate_note_file_name(
            &folder_full,
            timestamp,
            &note_id,
            &content,
            &fallback,
            args.file_name_format,
        )?;
        let path = folder_full.join(&file_name);
        let mut meta = NoteFrontMatter::default();
        meta.id = Some(note_id);
        meta.created_ms = Some(timestamp);
        meta.updated_ms = Some(timestamp);
        self.repository.write_note(&path, &meta, &content)?;
        if !self.repository.is_feed_folder_path(&folder_full) {
            self.repository
                .update_order_append(&folder_full, &[file_name], false)?;
        }

        Ok(CreateNoteResult {
            path: self.repository.strip_root(&path),
        })
    }

    pub fn write_note(&self, path: &str, content: &str) -> Result<(), String> {
        let full_path = self.repository.resolve_path(path)?;
        if let Some(parent) = full_path.parent() {
            self.repository.create_dir_all(parent)?;
        }
        let mut meta = if self.repository.entry_kind(&full_path)?.is_some() {
            let existing = self.repository.read_to_string(&full_path)?;
            let (parsed, _) = self.documents.parse(&existing);
            parsed
        } else {
            NoteFrontMatter::default()
        };
        if meta.id.is_none() {
            meta.id = Some(self.ids.generate_note_id());
        }
        let now = self.clock.now_ms();
        if meta.created_ms.is_none() {
            meta.created_ms = now;
        }
        meta.updated_ms = now.or(meta.updated_ms);
        self.repository.write_note(&full_path, &meta, content)
    }

    pub fn set_note_timestamp(&self, args: SetNoteTimestampArgs) -> Result<(), String> {
        let full_path = self.repository.resolve_path(&args.path)?;
        if self.repository.entry_kind(&full_path)? != Some(NoteStorageEntryKind::File) {
            return Err("Note file does not exist.".to_string());
        }
        let raw = self.repository.read_to_string(&full_path)?;
        let (mut meta, body) = self.documents.parse(&raw);
        let body = self.crypto.decrypt_note_body(&body)?;
        if meta.id.is_none() {
            meta.id = Some(self.ids.generate_note_id());
        }
        if meta.created_ms.is_none() || meta.created_ms.unwrap_or(i64::MAX) > args.timestamp_ms {
            meta.created_ms = Some(args.timestamp_ms);
        }
        meta.updated_ms = Some(args.timestamp_ms);
        self.repository.write_note(&full_path, &meta, &body)
    }

    pub fn get_note_meta(&self, path: &str) -> Result<NoteMeta, String> {
        let full_path = self.repository.resolve_path(path)?;
        let front_matter_meta = if self.repository.entry_kind(&full_path)?.is_some() {
            let raw = self.repository.read_to_string(&full_path)?;
            let (front_matter_meta, _) = self.documents.parse(&raw);
            front_matter_meta
        } else {
            NoteFrontMatter::default()
        };
        self.note_meta_from_front_matter(&front_matter_meta, &full_path)
    }

    /// Bulk preview fetch: one filesystem pass returning decrypted body + meta
    /// per note. Unreadable or vanished notes are skipped so a single broken
    /// file cannot take down the whole list.
    pub fn list_note_previews(
        &self,
        paths: Vec<String>,
    ) -> Result<Vec<NotePreviewEntry>, String> {
        let mut entries = Vec::with_capacity(paths.len());
        for path in paths {
            let Ok(full_path) = self.repository.resolve_path(&path) else {
                continue;
            };
            if self.repository.entry_kind(&full_path)? != Some(NoteStorageEntryKind::File) {
                continue;
            }
            let Ok(raw) = self.repository.read_to_string(&full_path) else {
                continue;
            };
            let (front_matter_meta, body) = self.documents.parse(&raw);
            let Ok(content) = self.crypto.decrypt_note_body(&body) else {
                continue;
            };
            let Ok(meta) = self.note_meta_from_front_matter(&front_matter_meta, &full_path) else {
                continue;
            };
            entries.push(NotePreviewEntry {
                path,
                content,
                meta,
            });
        }
        Ok(entries)
    }

    fn note_meta_from_front_matter(
        &self,
        front_matter_meta: &NoteFrontMatter,
        full_path: &std::path::Path,
    ) -> Result<NoteMeta, String> {
        let (file_created, file_modified) = self.repository.file_times(full_path)?;
        let created_ms = front_matter_meta
            .created_ms
            .or_else(|| file_created.and_then(|time| self.clock.time_to_ms(time)));
        let updated_ms = front_matter_meta
            .updated_ms
            .or_else(|| file_modified.and_then(|time| self.clock.time_to_ms(time)));
        Ok(NoteMeta {
            created_ms,
            updated_ms,
            note_type: front_matter_meta.note_type.clone(),
            archived_ms: front_matter_meta.archived_ms,
            reviewed_ms: front_matter_meta.reviewed_ms,
            recording_audio_path: front_matter_meta.recording_audio_path.clone(),
            handwriting_attachment_path: front_matter_meta.handwriting_attachment_path.clone(),
            transcription_status: front_matter_meta.transcription_status.clone(),
            transcription_error: front_matter_meta.transcription_error.clone(),
            transcription_updated_ms: front_matter_meta.transcription_updated_ms,
            ocr_status: front_matter_meta.ocr_status.clone(),
            ocr_error: front_matter_meta.ocr_error.clone(),
            ocr_updated_ms: front_matter_meta.ocr_updated_ms,
        })
    }

    pub fn update_note_markers(
        &self,
        path: &str,
        archived: Option<bool>,
        reviewed: Option<bool>,
    ) -> Result<(), String> {
        let full_path = self.repository.resolve_path(path)?;
        if self.repository.entry_kind(&full_path)? != Some(NoteStorageEntryKind::File) {
            return Err("Note file does not exist.".to_string());
        }
        let raw = self.repository.read_to_string(&full_path)?;
        let (mut meta, body) = self.documents.parse(&raw);
        let body = self.crypto.decrypt_note_body(&body)?;

        if meta.id.is_none() {
            meta.id = Some(self.ids.generate_note_id());
        }

        let now = self.clock.now_ms();
        let mut changed = false;

        if let Some(enabled) = archived {
            let next = enabled.then_some(now).flatten();
            if meta.archived_ms != next {
                meta.archived_ms = next;
                changed = true;
            }
        }

        if let Some(enabled) = reviewed {
            let next = enabled.then_some(now).flatten();
            if meta.reviewed_ms != next {
                meta.reviewed_ms = next;
                changed = true;
            }
        }

        if changed {
            meta.updated_ms = now.or(meta.updated_ms);
            self.repository.write_note(&full_path, &meta, &body)?;
        }
        Ok(())
    }

    pub fn move_items(&self, items: Vec<String>, destination: String) -> Result<(), String> {
        self.repository.ensured_root()?;
        let destination_path = self.repository.resolve_path(&destination)?;
        if self.repository.entry_kind(&destination_path)? != Some(NoteStorageEntryKind::Directory) {
            self.repository.create_dir_all(&destination_path)?;
        }

        let mut source_groups_folders: HashMap<PathBuf, Vec<String>> = HashMap::new();
        let mut source_groups_notes: HashMap<PathBuf, Vec<String>> = HashMap::new();
        let mut moved_folder_names = Vec::new();
        let mut moved_note_names = Vec::new();

        for item in items {
            let source = self.repository.resolve_path(&item)?;
            if self.repository.is_system_folder_path(&source) {
                return Err(format!(
                    "Cannot move system folder: {}",
                    source.to_string_lossy()
                ));
            }
            let source_kind = self.repository.entry_kind(&source)?;
            if source_kind.is_none() {
                return Err(format!(
                    "Source does not exist: {}",
                    source.to_string_lossy()
                ));
            }
            let name = source
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| "Invalid item name.".to_string())?
                .to_string();
            let parent = source
                .parent()
                .ok_or_else(|| "Missing parent folder.".to_string())?
                .to_path_buf();

            let target = destination_path.join(&name);
            self.repository.rename(&source, &target).map_err(|err| {
                format!(
                    "Move failed {} -> {}: {}",
                    source.to_string_lossy(),
                    target.to_string_lossy(),
                    err
                )
            })?;
            if source_kind == Some(NoteStorageEntryKind::Directory) {
                source_groups_folders
                    .entry(parent)
                    .or_default()
                    .push(name.clone());
                moved_folder_names.push(name);
            } else {
                source_groups_notes
                    .entry(parent)
                    .or_default()
                    .push(name.clone());
                moved_note_names.push(name);
            }
        }

        for (parent, names) in source_groups_folders {
            self.repository.update_order_remove(&parent, &names, true)?;
        }

        for (parent, names) in source_groups_notes {
            self.repository
                .update_order_remove(&parent, &names, false)?;
        }

        if !moved_folder_names.is_empty() {
            self.repository
                .update_order_append(&destination_path, &moved_folder_names, true)?;
        }
        if !moved_note_names.is_empty() {
            self.repository
                .update_order_append(&destination_path, &moved_note_names, false)?;
        }

        Ok(())
    }

    pub fn delete_items(&self, items: Vec<String>) -> Result<(), String> {
        self.repository.ensured_root()?;
        let mut parent_folder_groups: HashMap<PathBuf, Vec<String>> = HashMap::new();
        let mut parent_note_groups: HashMap<PathBuf, Vec<String>> = HashMap::new();

        for item in items {
            let full_path = self.repository.resolve_path(&item)?;
            if self.repository.is_system_folder_path(&full_path) {
                return Err(format!(
                    "Cannot delete system folder: {}",
                    full_path.to_string_lossy()
                ));
            }
            let name = full_path
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| "Invalid item name.".to_string())?
                .to_string();
            let parent = full_path
                .parent()
                .ok_or_else(|| "Missing parent folder.".to_string())?
                .to_path_buf();
            let kind = self
                .repository
                .entry_kind(&full_path)?
                .ok_or_else(|| "Item does not exist.".to_string())?;
            if kind == NoteStorageEntryKind::Directory {
                self.repository.remove_dir_all(&full_path)?;
                parent_folder_groups.entry(parent).or_default().push(name);
            } else {
                self.repository.remove_file(&full_path)?;
                parent_note_groups.entry(parent).or_default().push(name);
            }
        }

        for (parent, names) in parent_folder_groups {
            self.repository.update_order_remove(&parent, &names, true)?;
        }

        for (parent, names) in parent_note_groups {
            self.repository
                .update_order_remove(&parent, &names, false)?;
        }

        Ok(())
    }

    pub fn rename_item(&self, path: &str, new_name: &str) -> Result<String, String> {
        self.repository.ensured_root()?;
        let full_path = self.repository.resolve_path(path)?;
        if self.repository.is_system_folder_path(&full_path) {
            return Err(format!(
                "Cannot rename system folder: {}",
                full_path.to_string_lossy()
            ));
        }
        let parent = full_path
            .parent()
            .ok_or_else(|| "Missing parent folder.".to_string())?;
        let old_name = full_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Invalid item name.".to_string())?
            .to_string();
        let is_folder =
            self.repository.entry_kind(&full_path)? == Some(NoteStorageEntryKind::Directory);
        let new_path = parent.join(new_name);
        if new_path != full_path && self.repository.entry_kind(&new_path)?.is_some() {
            // On case-insensitive filesystems (the macOS/Windows default),
            // new_path can "exist" only because it's the same entry as
            // full_path under a different case (e.g. "calle-me" ->
            // "Calle-Me") — canonicalize both to allow that, not just a
            // literal path match.
            let same_entry = std::fs::canonicalize(&full_path)
                .ok()
                .zip(std::fs::canonicalize(&new_path).ok())
                .is_some_and(|(a, b)| a == b);
            if !same_entry {
                return Err(format!(
                    "\"{}\" already exists here.",
                    new_path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or(new_name)
                ));
            }
        }
        self.repository.rename(&full_path, &new_path)?;
        self.repository
            .update_order_rename(parent, &old_name, new_name, is_folder)?;

        Ok(self.repository.strip_root(&new_path))
    }

    pub fn set_order(&self, args: SetOrderArgs) -> Result<(), String> {
        self.repository.ensured_root()?;
        let parent_path = self.repository.resolve_path(&args.parent)?;
        if self.repository.is_feed_folder_path(&parent_path) {
            return Ok(());
        }
        let order = OrderFile {
            folder_order: args.folder_order,
            note_order: args.note_order,
        };
        self.repository.write_order_file(&parent_path, &order)
    }
}
