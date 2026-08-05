//! Object-storage sync for the active working folder, mirroring the desktop
//! `commands/object_sync.rs` surface.
//!
//! Args and results are JSON strings matching the same TS wire types the Tauri
//! shell uses, so one set of types in `@typenotes/shared` fits both shells.

use type_core::{
    application::object_sync::ObjectSyncUseCases, ObjectStoreSettings, ObjectSyncAdapter,
};

use crate::{from_json, run_blocking, to_json, unlocked_env, CoreError};

fn object_sync_use_cases() -> Result<ObjectSyncUseCases<ObjectSyncAdapter>, String> {
    Ok(ObjectSyncUseCases::new(ObjectSyncAdapter::new(
        unlocked_env()?,
    )))
}

/// Sync state of the active working folder as JSON (`ObjectSyncStatus`).
#[uniffi::export(async_runtime = "tokio")]
pub async fn get_object_sync_status() -> Result<String, CoreError> {
    run_blocking(|| to_json(&object_sync_use_cases()?.status()?)).await
}

/// This device's bucket connection as JSON (`ObjectStoreSettings`).
#[uniffi::export(async_runtime = "tokio")]
pub async fn get_object_sync_settings() -> Result<String, CoreError> {
    run_blocking(|| to_json(&object_sync_use_cases()?.settings()?)).await
}

/// `settings_json`: `ObjectStoreSettings`. Returns JSON `ObjectSyncStatus`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn set_object_sync_settings(settings_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let settings: ObjectStoreSettings = from_json(&settings_json)?;
        to_json(&object_sync_use_cases()?.save_settings(settings)?)
    })
    .await
}

/// Round-trip the bucket to validate credentials before saving them.
#[uniffi::export(async_runtime = "tokio")]
pub async fn test_object_sync_connection(settings_json: String) -> Result<(), CoreError> {
    run_blocking(move || {
        let settings: ObjectStoreSettings = from_json(&settings_json)?;
        object_sync_use_cases()?.test_connection(settings)
    })
    .await
}

/// Run a round now and wait for it. Returns JSON `SyncOutcome`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn object_sync_now() -> Result<String, CoreError> {
    run_blocking(|| to_json(&object_sync_use_cases()?.sync_now()?)).await
}

/// Ask the scheduler for a round soon; returns immediately. Call this from
/// capture flush, screen changes, and app foreground.
#[uniffi::export(async_runtime = "tokio")]
pub async fn request_object_sync(reason: Option<String>) -> Result<(), CoreError> {
    run_blocking(move || {
        object_sync_use_cases()?.request_sync(reason.as_deref().unwrap_or("auto"))
    })
    .await
}
