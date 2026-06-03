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

#[tauri::command]
pub(super) async fn discover_local_sync_servers(
    app: tauri::AppHandle,
    timeout_ms: Option<u64>,
) -> Result<Vec<DiscoveredServer>, String> {
    ensure_security_unlocked_for_app(&app)?;
    super::run_blocking_command(move || {
        discover_local_sync_servers_impl(timeout_ms.unwrap_or(2500))
    })
    .await
}
