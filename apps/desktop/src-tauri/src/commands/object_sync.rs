use type_core::{
    application::object_sync::ObjectSyncUseCases,
    domain::object_sync::{ObjectSyncStatus, SyncOutcome},
    ensure_security_unlocked_for_app, ObjectStoreSettings, ObjectSyncAdapter,
};

fn object_sync_use_cases(
    app: tauri::AppHandle,
) -> Result<ObjectSyncUseCases<ObjectSyncAdapter>, String> {
    Ok(ObjectSyncUseCases::new(ObjectSyncAdapter::new(
        crate::app_env(&app)?,
    )))
}

#[tauri::command]
pub(super) async fn get_object_sync_status(
    app: tauri::AppHandle,
) -> Result<ObjectSyncStatus, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || object_sync_use_cases(app)?.status()).await
}

#[tauri::command]
pub(super) async fn get_object_sync_settings(
    app: tauri::AppHandle,
) -> Result<ObjectStoreSettings, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || object_sync_use_cases(app)?.settings()).await
}

#[tauri::command]
pub(super) async fn set_object_sync_settings(
    app: tauri::AppHandle,
    settings: ObjectStoreSettings,
) -> Result<ObjectSyncStatus, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || object_sync_use_cases(app)?.save_settings(settings)).await
}

/// Round-trip the bucket before saving, so a typo in the endpoint or a wrong
/// key surfaces here rather than as a failing background round.
#[tauri::command]
pub(super) async fn test_object_sync_connection(
    app: tauri::AppHandle,
    settings: ObjectStoreSettings,
) -> Result<(), String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || object_sync_use_cases(app)?.test_connection(settings)).await
}

/// Run a round now and wait for it — the manual "Sync now" button.
#[tauri::command]
pub(super) async fn object_sync_now(app: tauri::AppHandle) -> Result<SyncOutcome, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || object_sync_use_cases(app)?.sync_now()).await
}

/// Nudge the scheduler and return immediately. This is what the editor and
/// window-focus handlers call; the core decides when a round actually runs.
#[tauri::command]
pub(super) async fn request_object_sync(
    app: tauri::AppHandle,
    reason: Option<String>,
) -> Result<(), String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || {
        object_sync_use_cases(app)?.request_sync(reason.as_deref().unwrap_or("auto"))
    })
    .await
}

/// Drop blobs no device references any more. Desktop-only on purpose: it lists
/// the whole bucket, which is not something a phone should be doing.
#[tauri::command]
pub(super) async fn collect_object_sync_garbage(app: tauri::AppHandle) -> Result<usize, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || object_sync_use_cases(app)?.collect_garbage()).await
}

/// Turn on end-to-end encryption for this bucket.
///
/// Rewrites every stored object under new keys and removes the plaintext ones.
/// Local notes are untouched.
#[tauri::command]
pub(super) async fn enable_object_sync_encryption(
    app: tauri::AppHandle,
    passphrase: String,
) -> Result<ObjectSyncStatus, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || {
        object_sync_use_cases(app)?.enable_encryption(&passphrase)
    })
    .await
}

/// Adopt an already-encrypted bucket on this device using its secret phrase.
#[tauri::command]
pub(super) async fn unlock_object_sync_encryption(
    app: tauri::AppHandle,
    passphrase: String,
) -> Result<ObjectSyncStatus, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || {
        object_sync_use_cases(app)?.unlock_encryption(&passphrase)
    })
    .await
}

/// The link rendered as a pairing QR. Carries bucket credentials *and* the
/// vault key, so the UI must only show it on an explicit user action.
#[tauri::command]
pub(super) async fn get_object_sync_pairing_link(
    app: tauri::AppHandle,
) -> Result<String, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || object_sync_use_cases(app)?.pairing_link()).await
}
