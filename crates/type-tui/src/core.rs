//! The bridge to `type-core`.
//!
//! This is the only module that knows how the shared core is wired together.
//! Everything else in the TUI talks to `Core` and to the plain DTOs the core
//! hands back, exactly like the Tauri commands and the UniFFI exports do.
//!
//! There is deliberately no abstraction layer here: `NotesService` already *is*
//! the use-case boundary, so wrapping it again would only add indirection.

use std::path::PathBuf;

use type_core::{
    application::{git_sync::GitSyncUseCases, notes::NotesService},
    notes_root, AppEnv, FilesystemNotesRepository, FrontMatterNoteDocumentCodec, GitSyncAdapter,
    RuntimeNoteBodyCrypto, SystemNoteClock, UuidNoteIdGenerator,
};

/// App-data directory used when `TYPE_TUI_APP_DATA_DIR` is unset.
///
/// This intentionally points at the **dev** identifier, not the production
/// `com.digital.type2`. The TUI runs the same note lifecycle as the desktop app
/// — it auto-renames files to content slugs and deletes notes that become empty
/// — so pointing it at a real notes root by accident edits real content. See
/// the "Never run the desktop app against production data" gotcha in AGENTS.md.
///
/// To work against a real notes root, set the env var explicitly:
///
/// ```text
/// TYPE_TUI_APP_DATA_DIR="$HOME/.local/share/com.digital.type2" type-tui
/// ```
const DEV_APP_IDENTIFIER: &str = "com.digital.type2.dev";

/// The concrete `NotesService` this shell uses.
///
/// The five type parameters are the port implementations. They are all
/// zero-sized except the repository, which owns the resolved notes root.
pub type Notes = NotesService<
    FilesystemNotesRepository,
    FrontMatterNoteDocumentCodec,
    RuntimeNoteBodyCrypto,
    UuidNoteIdGenerator,
    SystemNoteClock,
>;

/// Holds the shell seam (`AppEnv`) and builds core services on demand.
///
/// `Clone` is cheap (one `AppEnv`, which is two `PathBuf`s) and lets the event
/// loop hand a fresh copy to a background thread for async git operations.
#[derive(Clone)]
pub struct Core {
    env: AppEnv,
}

impl Core {
    pub fn new() -> Result<Self, String> {
        let app_data_dir = match std::env::var("TYPE_TUI_APP_DATA_DIR") {
            Ok(value) if !value.trim().is_empty() => PathBuf::from(value.trim()),
            _ => dirs::data_dir()
                .ok_or_else(|| "Could not resolve the platform data directory.".to_string())?
                .join(DEV_APP_IDENTIFIER),
        };

        let mut env = AppEnv::new(app_data_dir);
        if let Some(documents) = dirs::document_dir() {
            env = env.with_documents_dir(documents);
        }
        Ok(Self { env })
    }

    /// Build a notes service.
    ///
    /// Constructed per call on purpose: it is cheap (four unit structs plus one
    /// `PathBuf`), and `notes_root` re-reads the active profile every time, so
    /// a profile switch made elsewhere is picked up without any invalidation
    /// logic on our side.
    pub fn notes(&self) -> Result<Notes, String> {
        let root = notes_root(&self.env)?;
        Ok(NotesService::new(
            FilesystemNotesRepository::new(root),
            FrontMatterNoteDocumentCodec,
            RuntimeNoteBodyCrypto,
            UuidNoteIdGenerator,
            SystemNoteClock,
        ))
    }

    /// Git sync use cases (status / pull / push / SSH key management).
    pub fn git(&self) -> GitSyncUseCases<GitSyncAdapter> {
        GitSyncUseCases::new(GitSyncAdapter::new(self.env.clone()))
    }

    /// Absolute path of the active profile's notes root — shown in the status
    /// bar so it is always obvious which folder is being edited.
    pub fn root_path(&self) -> Result<PathBuf, String> {
        notes_root(&self.env)
    }
}
