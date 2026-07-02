//! UniFFI bindings over [`type_core`] for non-Tauri shells — React Native via
//! uniffi-bindgen-react-native, or any UniFFI-supported host (Swift/Kotlin).
//!
//! Design:
//! - The Tauri shell speaks JSON over IPC, and this crate mirrors that
//!   contract: structured inputs arrive as JSON strings deserialized into the
//!   same serde arg structs the desktop commands use, and structured outputs
//!   are returned as JSON strings. One set of TypeScript types therefore fits
//!   both shells.
//! - Every exported function is async: core work runs on the Tokio blocking
//!   pool so long git/transcription calls never block the host's JS thread.
//! - [`init_core`] must be called with the app's data directory before any
//!   other function.
//! - Transcription is pluggable: hosts implement [`TranscriptionProvider`]
//!   (a foreign trait) and pass it to `queue_provider_transcriptions` to run
//!   e.g. native on-device speech recognition against pending recordings.

uniffi::setup_scaffolding!();

mod git_sync;
mod notes;
mod profiles;
mod recordings;
mod security;

pub use git_sync::*;
pub use notes::*;
pub use profiles::*;
pub use recordings::*;
pub use security::*;

#[cfg(test)]
mod tests;

use std::sync::RwLock;
use type_core::AppEnv;

// ── Errors ─────────────────────────────────────────────────────────────────────

/// Error surfaced across the FFI boundary. Core reports errors as strings;
/// this wraps them so bindings raise a typed exception with the message.
#[derive(Debug, uniffi::Error)]
#[uniffi(flat_error)]
pub enum CoreError {
    Failure(String),
}

impl std::fmt::Display for CoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CoreError::Failure(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for CoreError {}

impl From<String> for CoreError {
    fn from(message: String) -> Self {
        CoreError::Failure(message)
    }
}

// ── App environment ────────────────────────────────────────────────────────────

static APP_ENV: RwLock<Option<AppEnv>> = RwLock::new(None);

/// Initialize the core with the host app's directories. Must be called before
/// any other function. Idempotent — calling it again (e.g. after a React
/// Native reload) replaces the environment.
#[uniffi::export]
pub fn init_core(app_data_dir: String, documents_dir: Option<String>) -> Result<(), CoreError> {
    let mut env = AppEnv::new(app_data_dir);
    if let Some(dir) = documents_dir {
        env = env.with_documents_dir(dir);
    }
    // Mirrors the Tauri shell's setup hook: load persisted security config so
    // the locked/unlocked gate is correct before the first command runs.
    type_core::ensure_security_runtime_initialized_for_setup(&env)?;
    *APP_ENV.write().expect("app env lock poisoned") = Some(env);
    Ok(())
}

/// The environment registered by [`init_core`].
pub(crate) fn current_env() -> Result<AppEnv, String> {
    APP_ENV
        .read()
        .expect("app env lock poisoned")
        .clone()
        .ok_or_else(|| "Core is not initialized — call init_core first.".to_string())
}

/// [`current_env`] plus the same lock gate the desktop commands apply: fails
/// while encrypted mode is locked so note bodies are never served locked.
pub(crate) fn unlocked_env() -> Result<AppEnv, String> {
    let env = current_env()?;
    type_core::ensure_security_unlocked_for_app(&env)?;
    Ok(env)
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

/// Run a blocking core workflow on the Tokio blocking pool.
pub(crate) async fn run_blocking<T, F>(task: F) -> Result<T, CoreError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|error| CoreError::Failure(format!("Background task failed: {error}")))?
        .map_err(CoreError::from)
}

pub(crate) fn to_json<T: serde::Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| format!("Failed to serialize response: {error}"))
}

pub(crate) fn from_json<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, String> {
    serde_json::from_str(json).map_err(|error| format!("Invalid arguments: {error}"))
}
