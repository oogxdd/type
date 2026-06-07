use std::{collections::HashMap, path::PathBuf};

use crate::{
    ports::notes::{
        NoteBodyCrypto, NoteClock, NoteDocumentCodec, NoteHistory, NoteIdGenerator,
        NoteStorageEntryKind, NotesRepository,
    },
    CreateNoteArgs, CreateNoteResult, FolderNode, NoteFrontMatter, NoteMeta, OrderFile,
    SetNoteTimestampArgs, SetOrderArgs, FEED_FOLDER,
};

/// Note use cases. This layer owns workflow and policy while persistence,
/// document parsing, encryption, history, IDs, and time are supplied as ports.
pub(crate) struct NotesService<R, D, C, H, I, T> {
    repository: R,
    documents: D,
    crypto: C,
    history: H,
    ids: I,
    clock: T,
}

impl<R, D, C, H, I, T> NotesService<R, D, C, H, I, T>
where
    R: NotesRepository,
    D: NoteDocumentCodec,
    C: NoteBodyCrypto,
    H: NoteHistory,
    I: NoteIdGenerator,
    T: NoteClock,
{
    pub(crate) fn new(
        repository: R,
        documents: D,
        crypto: C,
        history: H,
        ids: I,
        clock: T,
    ) -> Self {
        Self {
            repository,
            documents,
            crypto,
            history,
            ids,
            clock,
        }
    }

    pub(crate) fn get_tree(&self) -> Result<FolderNode, String> {
        self.repository.ensured_root()?;
        self.repository.build_tree()
    }

    pub(crate) fn read_note(&self, path: &str) -> Result<String, String> {
        let full_path = self.repository.resolve_path(path)?;
        if self.repository.entry_kind(&full_path)? != Some(NoteStorageEntryKind::File) {
            return Err("Note file does not exist.".to_string());
        }
        let raw = self.repository.read_to_string(&full_path)?;
        let (_, body) = self.documents.parse(&raw);
        self.crypto.decrypt_note_body(&body)
    }

    pub(crate) fn create_note(&self, args: CreateNoteArgs) -> Result<CreateNoteResult, String> {
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

    pub(crate) fn write_note(&self, path: &str, content: &str) -> Result<(), String> {
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

    pub(crate) fn set_note_timestamp(&self, args: SetNoteTimestampArgs) -> Result<(), String> {
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

    pub(crate) fn get_note_meta(&self, path: &str) -> Result<NoteMeta, String> {
        let full_path = self.repository.resolve_path(path)?;
        let front_matter_meta = if self.repository.entry_kind(&full_path)?.is_some() {
            let raw = self.repository.read_to_string(&full_path)?;
            let (front_matter_meta, _) = self.documents.parse(&raw);
            front_matter_meta
        } else {
            NoteFrontMatter::default()
        };
        let (file_created, file_modified) = self.repository.file_times(&full_path)?;
        let note_rel = self.repository.strip_root(&full_path);
        let (history_created_ms, history_updated_ms) = self
            .history
            .note_timestamps(&note_rel)
            .unwrap_or((None, None));

        let created_ms = front_matter_meta
            .created_ms
            .or(history_created_ms)
            .or_else(|| file_created.and_then(|time| self.clock.time_to_ms(time)));
        let updated_ms = front_matter_meta
            .updated_ms
            .or(history_updated_ms)
            .or_else(|| file_modified.and_then(|time| self.clock.time_to_ms(time)));
        Ok(NoteMeta {
            created_ms,
            updated_ms,
            note_type: front_matter_meta.note_type.clone(),
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

    pub(crate) fn move_items(&self, items: Vec<String>, destination: String) -> Result<(), String> {
        self.repository.ensured_root()?;
        let destination_path = self.repository.resolve_path(&destination)?;
        if self.repository.entry_kind(&destination_path)? != Some(NoteStorageEntryKind::Directory) {
            return Err(format!(
                "Destination folder does not exist: {}",
                destination_path.to_string_lossy()
            ));
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

    pub(crate) fn delete_items(&self, items: Vec<String>) -> Result<(), String> {
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

    pub(crate) fn rename_item(&self, path: &str, new_name: &str) -> Result<String, String> {
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
        self.repository.rename(&full_path, &new_path)?;
        self.repository
            .update_order_rename(parent, &old_name, new_name, is_folder)?;

        Ok(self.repository.strip_root(&new_path))
    }

    pub(crate) fn set_order(&self, args: SetOrderArgs) -> Result<(), String> {
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
