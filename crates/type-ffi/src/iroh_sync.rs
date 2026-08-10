//! Mobile entry point for the loopback SSH-over-Iroh proxy.

use type_core::StartIrohClientArgs;

use crate::{from_json, run_blocking, to_json, unlocked_env, CoreError};

/// `args_json`: `StartIrohClientArgs`. Returns JSON `IrohClientStatus`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn start_iroh_sync_client(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: StartIrohClientArgs = from_json(&args_json)?;
        let status = type_core::start_iroh_sync_client(&unlocked_env()?, args)?;
        to_json(&status)
    })
    .await
}

/// Upload local recording audio to the paired desktop over Iroh.
#[uniffi::export(async_runtime = "tokio")]
pub async fn archive_mobile_audio_with_iroh() -> Result<String, CoreError> {
    run_blocking(|| to_json(&type_core::archive_mobile_audio_with_iroh(&unlocked_env()?)?)).await
}

/// Toggle out-of-band audio paths in this phone repo's local Git excludes.
#[uniffi::export(async_runtime = "tokio")]
pub async fn set_mobile_audio_git_exclusion(enabled: bool) -> Result<(), CoreError> {
    run_blocking(move || {
        type_core::set_mobile_audio_git_exclusion(&unlocked_env()?, enabled)?;
        Ok(())
    })
    .await
}
