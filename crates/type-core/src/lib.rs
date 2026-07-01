//! Framework-free core of the Type notes app.
//!
//! Everything in this crate is plain Rust — no Tauri, no React Native. Shells
//! (the Tauri desktop/iOS app, the UniFFI mobile bindings) construct an
//! [`AppEnv`] from their platform APIs and hand it to the adapters here.
//!
//! Layers mirror the original backend layout:
//!   domain/       framework-free DTOs and state
//!   ports/        contracts + application-facing gateway traits
//!   application/  use-case services (depend only on ports)
//!   adapters/     real implementations (filesystem, git2, crypto, HTTP, …)

pub mod domain;
pub use domain::notes::*;

pub mod ports;

pub mod application;

// Adapters — implementations of the port contracts. Re-exported at the crate
// root so shells and internal code can import symbols without path gymnastics.
pub mod adapters;
pub use adapters::*;

// Shared external crate re-exports (used across modules via `crate::…`).
pub use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

pub use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
};

// ---------------------------------------------------------------------------
// AppEnv — the only thing a shell must provide
// ---------------------------------------------------------------------------

/// Per-app filesystem context supplied by the shell (Tauri, UniFFI, tests).
///
/// This replaces the Tauri app handle that used to thread through the
/// adapters: the core only ever needed the handle to resolve these
/// directories.
#[derive(Clone, Debug)]
pub struct AppEnv {
    /// App-data directory: profiles registry, security config, SSH keys,
    /// the managed whisper env, and the default location for notes roots.
    pub app_data_dir: PathBuf,
    /// Platform "Documents" directory, when the shell knows one (used by the
    /// profile export). `None` on platforms without a meaningful documents dir.
    pub documents_dir: Option<PathBuf>,
}

impl AppEnv {
    pub fn new(app_data_dir: impl Into<PathBuf>) -> Self {
        Self {
            app_data_dir: app_data_dir.into(),
            documents_dir: None,
        }
    }

    pub fn with_documents_dir(mut self, documents_dir: impl Into<PathBuf>) -> Self {
        self.documents_dir = Some(documents_dir.into());
        self
    }
}

/// Resolve the app-data directory, creating it if absent.
pub fn app_data_dir(app: &AppEnv) -> Result<PathBuf, String> {
    let path = app.app_data_dir.clone();
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|err| err.to_string())?;
    }
    Ok(path)
}

// ---------------------------------------------------------------------------
// Shared constants — used across recordings, handwriting, and shells
// ---------------------------------------------------------------------------

pub const RECORDING_STATUS_PENDING: &str = "pending";
pub const RECORDING_STATUS_QUEUED: &str = "queued";
pub const RECORDING_STATUS_PROCESSING: &str = "processing";
pub const RECORDING_STATUS_COMPLETED: &str = "completed";
pub const RECORDING_STATUS_FAILED: &str = "failed";

// ---------------------------------------------------------------------------
// Shared utility functions
// ---------------------------------------------------------------------------

/// Current UTC time as milliseconds since UNIX epoch.
pub fn now_ms() -> Option<i64> {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?;
    i64::try_from(duration.as_millis()).ok()
}

/// Convert a `SystemTime` to milliseconds since UNIX epoch.
pub fn time_to_ms(time: std::time::SystemTime) -> Option<i64> {
    let duration = time.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(duration.as_millis()).ok()
}

/// Extract the parent folder portion of a relative note path.
pub fn note_parent_folder_path(note_rel: &str) -> String {
    note_rel
        .rsplit_once('/')
        .map(|(parent, _)| parent.to_string())
        .unwrap_or_default()
}

/// Decode a base64 data-URI payload, stripping any `data:...;base64,` prefix.
pub fn decode_base64_payload(payload: &str, kind: &str) -> Result<Vec<u8>, String> {
    let trimmed = payload.trim();
    if trimmed.is_empty() {
        return Err(format!("{} payload is empty.", kind));
    }
    let body = trimmed
        .split_once(',')
        .map(|(_, value)| value)
        .unwrap_or(trimmed);
    BASE64
        .decode(body)
        .map_err(|error| format!("Invalid base64 {} payload: {}", kind.to_lowercase(), error))
}

/// Decode base64-encoded audio bytes.
pub fn decode_audio_base64(payload: &str) -> Result<Vec<u8>, String> {
    decode_base64_payload(payload, "Audio")
}

/// Decode base64-encoded image bytes.
pub fn decode_image_base64(payload: &str) -> Result<Vec<u8>, String> {
    decode_base64_payload(payload, "Image")
}

/// Format an HTTP error response with status code and body.
pub fn response_error(status: reqwest::StatusCode, body: String, context: &str) -> String {
    let compact = body.replace('\n', " ");
    if compact.trim().is_empty() {
        format!("{} failed (HTTP {}).", context, status)
    } else {
        format!("{} failed (HTTP {}): {}", context, status, compact)
    }
}
