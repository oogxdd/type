use type_core::{
    ConfigureIrohDocsSyncArgs, IrohDocsBootstrapResult, IrohDocsSyncResult, IrohDocsSyncStatus,
    SetIrohDocsSyncPeerArgs,
};

#[tauri::command]
pub(super) async fn bootstrap_iroh_docs_sync(
    app: tauri::AppHandle,
) -> Result<IrohDocsBootstrapResult, String> {
    super::run_blocking_command(move || type_core::bootstrap_iroh_docs_sync(&crate::app_env(&app)?))
        .await
}

#[tauri::command]
pub(super) async fn configure_iroh_docs_sync(
    app: tauri::AppHandle,
    args: ConfigureIrohDocsSyncArgs,
) -> Result<IrohDocsSyncStatus, String> {
    super::run_blocking_command(move || {
        type_core::configure_iroh_docs_sync(&crate::app_env(&app)?, args)
    })
    .await
}

#[tauri::command]
pub(super) async fn set_iroh_docs_sync_peer(
    app: tauri::AppHandle,
    args: SetIrohDocsSyncPeerArgs,
) -> Result<IrohDocsSyncStatus, String> {
    super::run_blocking_command(move || {
        type_core::set_iroh_docs_sync_peer(&crate::app_env(&app)?, args)
    })
    .await
}

#[tauri::command]
pub(super) async fn get_iroh_docs_sync_status(
    app: tauri::AppHandle,
) -> Result<IrohDocsSyncStatus, String> {
    super::run_blocking_command(move || {
        type_core::get_iroh_docs_sync_status(&crate::app_env(&app)?)
    })
    .await
}

#[tauri::command]
pub(super) async fn sync_iroh_docs_now(
    app: tauri::AppHandle,
) -> Result<IrohDocsSyncResult, String> {
    super::run_blocking_command(move || type_core::sync_iroh_docs_now(&crate::app_env(&app)?)).await
}
