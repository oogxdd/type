use type_core::{
    application::local_sync::LocalSyncUseCases, ensure_security_unlocked_for_app, DiscoveredServer,
    LocalSyncAdapter, LocalSyncServerStatus,
};

fn local_sync_use_cases(
    app: tauri::AppHandle,
) -> Result<LocalSyncUseCases<LocalSyncAdapter>, String> {
    Ok(LocalSyncUseCases::new(LocalSyncAdapter::new(
        crate::app_env(&app)?,
    )))
}

#[tauri::command]
pub(super) async fn get_local_sync_server_status(
    app: tauri::AppHandle,
) -> Result<LocalSyncServerStatus, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || local_sync_use_cases(app)?.status()).await
}

#[tauri::command]
pub(super) async fn start_local_sync_server(
    app: tauri::AppHandle,
) -> Result<LocalSyncServerStatus, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || local_sync_use_cases(app)?.start()).await
}

#[tauri::command]
pub(super) async fn start_local_sync_request_listener(
    app: tauri::AppHandle,
) -> Result<LocalSyncServerStatus, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || local_sync_use_cases(app)?.start_request_listener()).await
}

#[tauri::command]
pub(super) async fn open_local_sync_window(
    app: tauri::AppHandle,
) -> Result<LocalSyncServerStatus, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || local_sync_use_cases(app)?.open_window()).await
}

#[tauri::command]
pub(super) async fn close_local_sync_window(
    app: tauri::AppHandle,
) -> Result<LocalSyncServerStatus, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || local_sync_use_cases(app)?.close_window()).await
}

#[tauri::command]
pub(super) async fn approve_local_sync_request(
    app: tauri::AppHandle,
) -> Result<LocalSyncServerStatus, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || local_sync_use_cases(app)?.approve()).await
}

#[tauri::command]
pub(super) async fn decline_local_sync_request(
    app: tauri::AppHandle,
) -> Result<LocalSyncServerStatus, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || local_sync_use_cases(app)?.decline()).await
}

#[tauri::command]
pub(super) async fn stop_local_sync_server(
    app: tauri::AppHandle,
) -> Result<LocalSyncServerStatus, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || local_sync_use_cases(app)?.stop()).await
}

#[tauri::command]
pub(super) async fn discover_local_sync_servers(
    app: tauri::AppHandle,
    timeout_ms: Option<u64>,
) -> Result<Vec<DiscoveredServer>, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || {
        local_sync_use_cases(app)?.discover(timeout_ms.unwrap_or(2500))
    })
    .await
}
