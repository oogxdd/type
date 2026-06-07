use crate::{
    application::notes::NotesService, ensure_security_unlocked_for_app, notes_root, CreateNoteArgs,
    CreateNoteResult, FilesystemNotesRepository, FolderNode, FrontMatterNoteDocumentCodec,
    GitNoteHistoryAdapter, NoteMeta, RuntimeNoteBodyCrypto, SetNoteTimestampArgs, SetOrderArgs,
    SystemNoteClock, UuidNoteIdGenerator,
};

fn notes_service(
    app: &tauri::AppHandle,
) -> Result<
    NotesService<
        FilesystemNotesRepository,
        FrontMatterNoteDocumentCodec,
        RuntimeNoteBodyCrypto,
        GitNoteHistoryAdapter,
        UuidNoteIdGenerator,
        SystemNoteClock,
    >,
    String,
> {
    let root = notes_root(app)?;
    Ok(NotesService::new(
        FilesystemNotesRepository::new(root.clone()),
        FrontMatterNoteDocumentCodec,
        RuntimeNoteBodyCrypto,
        GitNoteHistoryAdapter::new(root),
        UuidNoteIdGenerator,
        SystemNoteClock,
    ))
}

#[tauri::command]
pub(super) fn get_tree(app: tauri::AppHandle) -> Result<FolderNode, String> {
    ensure_security_unlocked_for_app(&app)?;
    notes_service(&app)?.get_tree()
}

#[tauri::command]
pub(super) fn read_note(app: tauri::AppHandle, path: String) -> Result<String, String> {
    ensure_security_unlocked_for_app(&app)?;
    notes_service(&app)?.read_note(&path)
}

#[tauri::command]
pub(super) fn create_note(
    app: tauri::AppHandle,
    args: CreateNoteArgs,
) -> Result<CreateNoteResult, String> {
    ensure_security_unlocked_for_app(&app)?;
    notes_service(&app)?.create_note(args)
}

#[tauri::command]
pub(super) fn write_note(
    app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<(), String> {
    ensure_security_unlocked_for_app(&app)?;
    notes_service(&app)?.write_note(&path, &content)
}

#[tauri::command]
pub(super) fn set_note_timestamp(
    app: tauri::AppHandle,
    args: SetNoteTimestampArgs,
) -> Result<(), String> {
    ensure_security_unlocked_for_app(&app)?;
    notes_service(&app)?.set_note_timestamp(args)
}

#[tauri::command]
pub(super) fn get_note_meta(app: tauri::AppHandle, path: String) -> Result<NoteMeta, String> {
    ensure_security_unlocked_for_app(&app)?;
    notes_service(&app)?.get_note_meta(&path)
}

#[tauri::command]
pub(super) fn move_items(
    app: tauri::AppHandle,
    items: Vec<String>,
    destination: String,
) -> Result<(), String> {
    ensure_security_unlocked_for_app(&app)?;
    notes_service(&app)?.move_items(items, destination)
}

#[tauri::command]
pub(super) fn delete_items(app: tauri::AppHandle, items: Vec<String>) -> Result<(), String> {
    ensure_security_unlocked_for_app(&app)?;
    notes_service(&app)?.delete_items(items)
}

#[tauri::command]
pub(super) fn rename_item(
    app: tauri::AppHandle,
    path: String,
    new_name: String,
) -> Result<String, String> {
    ensure_security_unlocked_for_app(&app)?;
    notes_service(&app)?.rename_item(&path, &new_name)
}

#[tauri::command]
pub(super) fn set_order(app: tauri::AppHandle, args: SetOrderArgs) -> Result<(), String> {
    ensure_security_unlocked_for_app(&app)?;
    notes_service(&app)?.set_order(args)
}
