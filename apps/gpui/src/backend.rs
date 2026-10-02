//! The native shell calls application services directly. No IPC or UI types here.
use std::{
    collections::HashSet,
    path::{Component, Path, PathBuf},
};
use type_core::{
    application::{notes::NotesService, profiles::ProfilesUseCases, security::SecurityUseCases},
    *,
};

type Notes = NotesService<
    FilesystemNotesRepository,
    FrontMatterNoteDocumentCodec,
    RuntimeNoteBodyCrypto,
    UuidNoteIdGenerator,
    SystemNoteClock,
>;

#[derive(Clone)]
pub struct Backend {
    pub env: AppEnv,
    pub root: PathBuf,
}

impl Backend {
    pub fn new(env: AppEnv) -> Result<Self, String> {
        ensure_security_runtime_initialized_for_setup(&env)?;
        let root = notes_root(&env)?;
        Ok(Self { env, root })
    }

    pub fn notes(&self) -> Result<Notes, String> {
        ensure_security_unlocked_for_app(&self.env)?;
        if !self.root.is_dir() {
            return Err(format!(
                "Profile folder is unavailable: {}. Add its new path in Settings → Profiles.",
                self.root.display()
            ));
        }
        Ok(NotesService::new(
            FilesystemNotesRepository::new(self.root.clone()),
            FrontMatterNoteDocumentCodec,
            RuntimeNoteBodyCrypto,
            UuidNoteIdGenerator,
            SystemNoteClock,
        ))
    }

    pub fn profiles(&self) -> ProfilesUseCases<ProfilesAdapter> {
        ProfilesUseCases::new(ProfilesAdapter::new(self.env.clone()))
    }

    pub fn security(&self) -> SecurityUseCases<SecurityAdapter> {
        SecurityUseCases::new(SecurityAdapter::new(self.env.clone()))
    }

    /// Compare the disk body before writing: sync, OCR and another window must
    /// never be silently overwritten by an old editor buffer.
    pub fn save(&self, path: &str, expected: &str, body: &str) -> Result<(), String> {
        let notes = self.notes()?;
        let disk = notes.read_note(path)?;
        if disk == body {
            return Ok(());
        }
        if disk != expected {
            return Err("This note changed outside the editor. Your draft is kept. Copy it or reload the note before saving.".into());
        }
        notes.write_note(path, body)
    }

    pub fn create(
        &self,
        folder: &str,
        body: String,
        timestamp: Option<i64>,
    ) -> Result<String, String> {
        validate_destination(folder, true)?;
        let config = load_app_config(&self.env.app_data_dir);
        let format = match config.note_file_name_format.as_str() {
            "uuid_v7" => NoteFileNameFormat::UuidV7,
            "uuid_v7_prefix_slug" => NoteFileNameFormat::UuidV7PrefixSlug,
            _ => NoteFileNameFormat::UtcTimestampSlug,
        };
        Ok(self
            .notes()?
            .create_note(CreateNoteArgs {
                folder_path: Some(folder.into()),
                content: Some(body),
                timestamp_ms: timestamp,
                file_name_format: format,
            })?
            .path)
    }

    /// Preflight the whole move before invoking the core, whose filesystem
    /// rename can replace an existing file on Unix.
    pub fn move_items(
        &self,
        paths: Vec<String>,
        destination: &str,
        allow_trash: bool,
    ) -> Result<(), String> {
        validate_destination(destination, allow_trash)?;
        let mut targets = HashSet::new();
        for path in &paths {
            validate_relative(path)?;
            if is_protected(path) {
                return Err("System folders cannot be moved.".into());
            }
            let source = self.root.join(path);
            let name = source.file_name().ok_or("Invalid source path.")?;
            let target = self.root.join(destination).join(name);
            if target == source {
                continue;
            }
            if target.starts_with(&source) {
                return Err("A folder cannot move into itself.".into());
            }
            if target.exists() || !targets.insert(target) {
                return Err(
                    "A destination item with this name already exists. Rename it first.".into(),
                );
            }
        }
        let paths = paths
            .into_iter()
            .filter(|path| note_parent_folder_path(path) != destination)
            .collect();
        self.notes()?.move_items(paths, destination.into())
    }

    /// Existing core move semantics create a destination even for an empty selection.
    pub fn create_folder(&self, path: &str) -> Result<(), String> {
        validate_destination(path, false)?;
        if path.is_empty() || self.root.join(path).exists() {
            return Err("A folder or file with this name already exists.".into());
        }
        self.notes()?.move_items(vec![], path.into())
    }

    pub fn rename(&self, path: &str, name: &str) -> Result<String, String> {
        validate_relative(path)?;
        if name.is_empty() || name.starts_with('.') || name.contains(['/', '\\']) || name == ".." {
            return Err("Use a file or folder name without separators.".into());
        }
        self.notes()?.rename_item(path, name)
    }
}

pub fn is_protected(path: &str) -> bool {
    path == "_system" || path.starts_with("_system/") && !path.ends_with(".md")
}

pub fn validate_relative(path: &str) -> Result<(), String> {
    if path.contains('\\')
        || Path::new(path)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("Use a relative path without . or .. components.".into());
    }
    Ok(())
}

pub fn validate_destination(path: &str, allow_capture: bool) -> Result<(), String> {
    validate_relative(path)?;
    if path.split('/').any(|s| s.starts_with('.'))
        || is_protected(path) && !(allow_capture && matches!(path, STREAM_FOLDER | ARCHIVE_FOLDER))
    {
        return Err("Choose a user folder as the destination.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        backend: Backend,
    }
    impl Fixture {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("type-gpui-test-{}", uuid_id()));
            Self {
                backend: Backend::new(AppEnv::new(dir)).unwrap(),
            }
        }
    }
    fn uuid_id() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        format!(
            "{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.backend.env.app_data_dir);
        }
    }

    #[test]
    fn real_core_persists_body_metadata_and_refuses_external_overwrite() {
        let f = Fixture::new();
        let b = &f.backend;
        let path = b
            .create(STREAM_FOLDER, "Привет\n".into(), Some(1234567890000))
            .unwrap();
        b.notes()
            .unwrap()
            .update_note_markers(&path, None, Some(true))
            .unwrap();
        b.save(&path, "Привет\n", "#todo Изменено\n").unwrap();
        let fresh = Backend::new(b.env.clone()).unwrap();
        assert_eq!(
            fresh.notes().unwrap().read_note(&path).unwrap(),
            "#todo Изменено\n"
        );
        assert!(
            fresh
                .notes()
                .unwrap()
                .get_note_meta(&path)
                .unwrap()
                .reviewed_ms
                .is_some()
        );
        fresh
            .notes()
            .unwrap()
            .write_note(&path, "external")
            .unwrap();
        assert!(b.save(&path, "#todo Изменено\n", "local draft").is_err());
        assert_eq!(b.notes().unwrap().read_note(&path).unwrap(), "external");
    }

    #[test]
    fn moves_preserve_data_and_reject_collisions_and_internal_destinations() {
        let f = Fixture::new();
        let b = &f.backend;
        let path = b.create(STREAM_FOLDER, "one".into(), None).unwrap();
        b.move_items(vec![path.clone()], "Work/Ideas", false)
            .unwrap();
        let name = Path::new(&path).file_name().unwrap().to_str().unwrap();
        let moved = format!("Work/Ideas/{name}");
        assert_eq!(b.notes().unwrap().read_note(&moved).unwrap(), "one");
        std::fs::create_dir_all(b.root.join("Other")).unwrap();
        std::fs::write(b.root.join("Other").join(name), "existing").unwrap();
        assert!(b.move_items(vec![moved.clone()], "Other", false).is_err());
        assert!(
            b.move_items(vec![moved.clone()], "_system/me", false)
                .is_err()
        );
        assert!(
            b.move_items(vec!["Work".into()], "Work/Ideas", false)
                .is_err()
        );
        assert!(b.rename(&moved, "../bad.md").is_err());
        assert_eq!(b.notes().unwrap().read_note(&moved).unwrap(), "one");
    }
}
