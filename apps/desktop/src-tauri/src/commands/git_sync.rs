use type_core::{
    application::git_sync::GitSyncUseCases, ensure_security_unlocked_for_app, ConnectGitArgs,
    GitCommitHistoryEntry, GitHistoryArgs, GitPushArgs, GitSyncAdapter, GitSyncArgs, GitSyncStatus,
};

fn git_sync_use_cases(app: tauri::AppHandle) -> Result<GitSyncUseCases<GitSyncAdapter>, String> {
    Ok(GitSyncUseCases::new(GitSyncAdapter::new(crate::app_env(
        &app,
    )?)))
}

#[tauri::command]
pub(super) fn generate_ssh_key(app: tauri::AppHandle) -> Result<String, String> {
    git_sync_use_cases(app)?.generate_ssh_key()
}

#[tauri::command]
pub(super) fn get_ssh_public_key(app: tauri::AppHandle) -> Result<Option<String>, String> {
    git_sync_use_cases(app)?.ssh_public_key()
}

#[tauri::command]
pub(super) fn delete_ssh_key(app: tauri::AppHandle) -> Result<(), String> {
    git_sync_use_cases(app)?.delete_ssh_key()
}

#[tauri::command]
pub(super) async fn get_git_status(app: tauri::AppHandle) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || git_sync_use_cases(app)?.status()).await
}

/// Cheap snapshot of the in-flight pull/push transfer progress, for UI polling.
#[tauri::command]
pub(super) fn get_git_sync_progress() -> type_core::GitTransferProgress {
    type_core::git_transfer_progress_snapshot()
}

#[tauri::command]
pub(super) async fn get_git_history(
    app: tauri::AppHandle,
    args: Option<GitHistoryArgs>,
) -> Result<Vec<GitCommitHistoryEntry>, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || git_sync_use_cases(app)?.history(args)).await
}

#[tauri::command]
pub(super) async fn connect_git_repo(
    app: tauri::AppHandle,
    args: ConnectGitArgs,
) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || git_sync_use_cases(app)?.connect(args)).await
}

#[tauri::command]
pub(super) async fn git_pull(
    app: tauri::AppHandle,
    args: GitSyncArgs,
) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || git_sync_use_cases(app)?.pull(args)).await
}

#[tauri::command]
pub(super) async fn git_push(
    app: tauri::AppHandle,
    args: GitPushArgs,
) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || git_sync_use_cases(app)?.push(args)).await
}
