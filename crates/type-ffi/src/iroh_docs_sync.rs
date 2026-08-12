//! Persistent encrypted filesystem sync over `iroh-docs`.

use type_core::{ConfigureIrohDocsSyncArgs, SetIrohDocsSyncPeerArgs};

use crate::{current_env, from_json, run_blocking, to_json, CoreError};

/// Import the trusted-device bundle scanned from the desktop.
#[uniffi::export(async_runtime = "tokio")]
pub async fn configure_iroh_docs_sync(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: ConfigureIrohDocsSyncArgs = from_json(&args_json)?;
        to_json(&type_core::configure_iroh_docs_sync(&current_env()?, args)?)
    })
    .await
}

/// Start the node when this profile has already been paired.
#[uniffi::export(async_runtime = "tokio")]
pub async fn start_iroh_docs_sync() -> Result<String, CoreError> {
    run_blocking(|| {
        to_json(&type_core::start_iroh_docs_sync_if_configured(
            &current_env()?,
        )?)
    })
    .await
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn get_iroh_docs_sync_status() -> Result<String, CoreError> {
    run_blocking(|| to_json(&type_core::get_iroh_docs_sync_status(&current_env()?)?)).await
}

/// Explicit user action; the Rust core reports concrete publish/apply counts.
#[uniffi::export(async_runtime = "tokio")]
pub async fn sync_iroh_docs_now() -> Result<String, CoreError> {
    run_blocking(|| to_json(&type_core::sync_iroh_docs_now(&current_env()?)?)).await
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn set_iroh_docs_sync_peer(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: SetIrohDocsSyncPeerArgs = from_json(&args_json)?;
        to_json(&type_core::set_iroh_docs_sync_peer(&current_env()?, args)?)
    })
    .await
}
