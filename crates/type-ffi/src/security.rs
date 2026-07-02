//! At-rest encryption + lock screen state, mirroring the desktop
//! `commands/security.rs` surface. These are intentionally NOT gated on the
//! unlock state — they are what the lock screen itself calls.

use type_core::{
    application::security::SecurityUseCases, EnableSecurityArgs, SecurityAdapter,
    SetSecurityPreferencesArgs, UnlockSecurityArgs,
};

use crate::{current_env, from_json, run_blocking, to_json, CoreError};

fn security_use_cases() -> Result<SecurityUseCases<SecurityAdapter>, String> {
    Ok(SecurityUseCases::new(SecurityAdapter::new(current_env()?)))
}

/// Current security state as JSON (`SecurityState`).
#[uniffi::export(async_runtime = "tokio")]
pub async fn get_security_state() -> Result<String, CoreError> {
    run_blocking(|| to_json(&security_use_cases()?.state()?)).await
}

/// `args_json`: `EnableSecurityArgs`. Returns JSON `SecurityState`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn enable_security(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: EnableSecurityArgs = from_json(&args_json)?;
        to_json(&security_use_cases()?.enable(args)?)
    })
    .await
}

/// Returns JSON `SecurityState`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn lock_security() -> Result<String, CoreError> {
    run_blocking(|| to_json(&security_use_cases()?.lock()?)).await
}

/// `args_json`: `UnlockSecurityArgs`. Returns JSON `SecurityUnlockResult`.
/// Entering the panic password wipes local data, exactly as on desktop.
#[uniffi::export(async_runtime = "tokio")]
pub async fn unlock_security(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: UnlockSecurityArgs = from_json(&args_json)?;
        to_json(&security_use_cases()?.unlock(args)?)
    })
    .await
}

/// `args_json`: `SetSecurityPreferencesArgs`. Returns JSON `SecurityState`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn set_security_preferences(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: SetSecurityPreferencesArgs = from_json(&args_json)?;
        to_json(&security_use_cases()?.set_preferences(args)?)
    })
    .await
}
