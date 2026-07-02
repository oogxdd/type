//! Note tree + CRUD, mirroring the desktop `commands/notes.rs` surface.

use type_core::{
    application::notes::NotesService, notes_root, CreateNoteArgs, FilesystemNotesRepository,
    FrontMatterNoteDocumentCodec, RuntimeNoteBodyCrypto, SetNoteMarkersArgs, SetNoteTimestampArgs,
    SetOrderArgs, SystemNoteClock, UuidNoteIdGenerator,
};

use crate::{from_json, run_blocking, to_json, unlocked_env, CoreError};

fn notes_service() -> Result<
    NotesService<
        FilesystemNotesRepository,
        FrontMatterNoteDocumentCodec,
        RuntimeNoteBodyCrypto,
        UuidNoteIdGenerator,
        SystemNoteClock,
    >,
    String,
> {
    let root = notes_root(&unlocked_env()?)?;
    Ok(NotesService::new(
        FilesystemNotesRepository::new(root),
        FrontMatterNoteDocumentCodec,
        RuntimeNoteBodyCrypto,
        UuidNoteIdGenerator,
        SystemNoteClock,
    ))
}

/// Folder tree as JSON (`FolderNode`).
#[uniffi::export(async_runtime = "tokio")]
pub async fn get_tree() -> Result<String, CoreError> {
    run_blocking(|| to_json(&notes_service()?.get_tree()?)).await
}

/// Note body (decrypted when encryption is enabled).
#[uniffi::export(async_runtime = "tokio")]
pub async fn read_note(path: String) -> Result<String, CoreError> {
    run_blocking(move || notes_service()?.read_note(&path)).await
}

/// `args_json`: `CreateNoteArgs`. Returns JSON `CreateNoteResult`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn create_note(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: CreateNoteArgs = from_json(&args_json)?;
        to_json(&notes_service()?.create_note(args)?)
    })
    .await
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn write_note(path: String, content: String) -> Result<(), CoreError> {
    run_blocking(move || notes_service()?.write_note(&path, &content)).await
}

/// `args_json`: `SetNoteTimestampArgs`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn set_note_timestamp(args_json: String) -> Result<(), CoreError> {
    run_blocking(move || {
        let args: SetNoteTimestampArgs = from_json(&args_json)?;
        notes_service()?.set_note_timestamp(args)
    })
    .await
}

/// `args_json`: `SetNoteMarkersArgs`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn update_note_markers(args_json: String) -> Result<(), CoreError> {
    run_blocking(move || {
        let args: SetNoteMarkersArgs = from_json(&args_json)?;
        notes_service()?.update_note_markers(&args.path, args.archived, args.reviewed)
    })
    .await
}

/// Note metadata as JSON (`NoteMeta`).
#[uniffi::export(async_runtime = "tokio")]
pub async fn get_note_meta(path: String) -> Result<String, CoreError> {
    run_blocking(move || to_json(&notes_service()?.get_note_meta(&path)?)).await
}

/// Bulk previews as JSON (`Vec<NotePreviewEntry>`).
#[uniffi::export(async_runtime = "tokio")]
pub async fn list_note_previews(paths: Vec<String>) -> Result<String, CoreError> {
    run_blocking(move || to_json(&notes_service()?.list_note_previews(paths)?)).await
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn move_items(items: Vec<String>, destination: String) -> Result<(), CoreError> {
    run_blocking(move || notes_service()?.move_items(items, destination)).await
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn delete_items(items: Vec<String>) -> Result<(), CoreError> {
    run_blocking(move || notes_service()?.delete_items(items)).await
}

/// Returns the item's new relative path.
#[uniffi::export(async_runtime = "tokio")]
pub async fn rename_item(path: String, new_name: String) -> Result<String, CoreError> {
    run_blocking(move || notes_service()?.rename_item(&path, &new_name)).await
}

/// `args_json`: `SetOrderArgs`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn set_order(args_json: String) -> Result<(), CoreError> {
    run_blocking(move || {
        let args: SetOrderArgs = from_json(&args_json)?;
        notes_service()?.set_order(args)
    })
    .await
}
