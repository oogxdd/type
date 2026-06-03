use crate::*;

#[tauri::command]
pub(super) async fn get_local_sync_server_status(
    app: tauri::AppHandle,
) -> Result<LocalSyncServerStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    super::run_blocking_command(move || local_sync_server_status(&app)).await
}

#[tauri::command]
pub(super) async fn start_local_sync_server(
    app: tauri::AppHandle,
) -> Result<LocalSyncServerStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    super::run_blocking_command(move || start_local_sync_server_impl(&app)).await
}

#[tauri::command]
pub(super) async fn stop_local_sync_server(
    app: tauri::AppHandle,
) -> Result<LocalSyncServerStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    super::run_blocking_command(move || stop_local_sync_server_impl(&app)).await
}
