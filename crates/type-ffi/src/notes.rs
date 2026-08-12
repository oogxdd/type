//! Note tree + CRUD, mirroring the desktop `commands/notes.rs` surface.

use type_core::{
    application::notes::NotesService, notes_root, AppEnv, CreateNoteArgs,
    FilesystemNotesRepository, FrontMatterNoteDocumentCodec, RuntimeNoteBodyCrypto,
    SetNoteMarkersArgs, SetNoteTimestampArgs, SetOrderArgs, SystemNoteClock, UuidNoteIdGenerator,
};

use crate::{from_json, run_blocking, to_json, unlocked_env, CoreError};

fn notes_service(
    env: &AppEnv,
) -> Result<
    NotesService<
        FilesystemNotesRepository,
        FrontMatterNoteDocumentCodec,
        RuntimeNoteBodyCrypto,
        UuidNoteIdGenerator,
        SystemNoteClock,
    >,
    String,
> {
    let root = notes_root(env)?;
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
    run_blocking(|| {
        let env = unlocked_env()?;
        to_json(&notes_service(&env)?.get_tree()?)
    })
    .await
}

/// Note body (decrypted when encryption is enabled).
#[uniffi::export(async_runtime = "tokio")]
pub async fn read_note(path: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let env = unlocked_env()?;
        notes_service(&env)?.read_note(&path)
    })
    .await
}

/// `args_json`: `CreateNoteArgs`. Returns JSON `CreateNoteResult`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn create_note(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let env = unlocked_env()?;
        let args: CreateNoteArgs = from_json(&args_json)?;
        let result = notes_service(&env)?.create_note(args)?;
        type_core::schedule_iroh_docs_sync(&env);
        to_json(&result)
    })
    .await
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn write_note(path: String, content: String) -> Result<(), CoreError> {
    run_blocking(move || {
        let env = unlocked_env()?;
        notes_service(&env)?.write_note(&path, &content)?;
        type_core::schedule_iroh_docs_sync(&env);
        Ok(())
    })
    .await
}

/// `args_json`: `SetNoteTimestampArgs`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn set_note_timestamp(args_json: String) -> Result<(), CoreError> {
    run_blocking(move || {
        let env = unlocked_env()?;
        let args: SetNoteTimestampArgs = from_json(&args_json)?;
        notes_service(&env)?.set_note_timestamp(args)?;
        type_core::schedule_iroh_docs_sync(&env);
        Ok(())
    })
    .await
}

/// `args_json`: `SetNoteMarkersArgs`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn update_note_markers(args_json: String) -> Result<(), CoreError> {
    run_blocking(move || {
        let env = unlocked_env()?;
        let args: SetNoteMarkersArgs = from_json(&args_json)?;
        notes_service(&env)?.update_note_markers(&args.path, args.archived, args.reviewed)?;
        type_core::schedule_iroh_docs_sync(&env);
        Ok(())
    })
    .await
}

/// Note metadata as JSON (`NoteMeta`).
#[uniffi::export(async_runtime = "tokio")]
pub async fn get_note_meta(path: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let env = unlocked_env()?;
        to_json(&notes_service(&env)?.get_note_meta(&path)?)
    })
    .await
}

/// Bulk previews as JSON (`Vec<NotePreviewEntry>`).
#[uniffi::export(async_runtime = "tokio")]
pub async fn list_note_previews(paths: Vec<String>) -> Result<String, CoreError> {
    run_blocking(move || {
        let env = unlocked_env()?;
        to_json(&notes_service(&env)?.list_note_previews(paths)?)
    })
    .await
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn move_items(items: Vec<String>, destination: String) -> Result<(), CoreError> {
    run_blocking(move || {
        let env = unlocked_env()?;
        notes_service(&env)?.move_items(items, destination)?;
        type_core::schedule_iroh_docs_sync(&env);
        Ok(())
    })
    .await
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn delete_items(items: Vec<String>) -> Result<(), CoreError> {
    run_blocking(move || {
        let env = unlocked_env()?;
        notes_service(&env)?.delete_items(items)?;
        type_core::schedule_iroh_docs_sync(&env);
        Ok(())
    })
    .await
}

/// Returns the item's new relative path.
#[uniffi::export(async_runtime = "tokio")]
pub async fn rename_item(path: String, new_name: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let env = unlocked_env()?;
        let result = notes_service(&env)?.rename_item(&path, &new_name)?;
        type_core::schedule_iroh_docs_sync(&env);
        Ok(result)
    })
    .await
}

/// `args_json`: `SetOrderArgs`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn set_order(args_json: String) -> Result<(), CoreError> {
    run_blocking(move || {
        let env = unlocked_env()?;
        let args: SetOrderArgs = from_json(&args_json)?;
        notes_service(&env)?.set_order(args)?;
        type_core::schedule_iroh_docs_sync(&env);
        Ok(())
    })
    .await
}
