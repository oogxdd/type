use type_core::{
    adapters::tag_registry::FilesystemTagRegistry, application::tag_registry::TagRegistryService,
    domain::tag_registry::TagRegistry, ensure_security_unlocked_for_app, notes_root,
};
fn service(
    app: &tauri::AppHandle,
    expected_root: &str,
) -> Result<TagRegistryService<FilesystemTagRegistry>, String> {
    let env = crate::app_env(app)?;
    ensure_security_unlocked_for_app(&env)?;
    let root = notes_root(&env)?;
    if root != std::path::PathBuf::from(expected_root) {
        return Err("Working folder changed.".into());
    }
    Ok(TagRegistryService(FilesystemTagRegistry(root)))
}
#[tauri::command]
pub(super) fn read_tag_registry(
    app: tauri::AppHandle,
    expected_root: String,
) -> Result<TagRegistry, String> {
    service(&app, &expected_root)?.read()
}
#[tauri::command]
pub(super) fn write_tag_registry(
    app: tauri::AppHandle,
    expected_root: String,
    registry: TagRegistry,
) -> Result<(), String> {
    service(&app, &expected_root)?.write(registry)
}
