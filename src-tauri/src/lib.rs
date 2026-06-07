// Port interfaces — platform-agnostic service contracts.
// Read these to understand what each domain does. When migrating to another
// language (JS, Dart, Swift …), reimplement the traits defined here.
pub mod domain;
pub(crate) use domain::notes::*;

pub mod ports;

mod application;

// Adapters — Rust/Tauri implementations of the port contracts.
// Each adapter module lives in adapters/ and is re-exported at the crate root
// so the rest of the code can import symbols without path gymnastics.
mod adapters;
pub(crate) use adapters::*;

// Commands — thin Tauri command layer that bridges the frontend to adapters.
mod commands;

// Shared external crate re-exports (used by commands.rs via `use super::*;`)
pub(crate) use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
#[cfg(target_os = "ios")]
pub(crate) use objc::runtime::Object;
#[cfg(target_os = "ios")]
pub(crate) use objc::{msg_send, sel, sel_impl};

pub(crate) use git2::{Direction, PushOptions, Repository};

pub(crate) use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
};

pub(crate) use tauri::Manager;

// ---------------------------------------------------------------------------
// Shared constants — used across recordings, handwriting, and commands
// ---------------------------------------------------------------------------

pub(crate) const RECORDING_STATUS_PENDING: &str = "pending";
pub(crate) const RECORDING_STATUS_QUEUED: &str = "queued";
pub(crate) const RECORDING_STATUS_PROCESSING: &str = "processing";
pub(crate) const RECORDING_STATUS_COMPLETED: &str = "completed";
pub(crate) const RECORDING_STATUS_FAILED: &str = "failed";

// ---------------------------------------------------------------------------
// macOS window transparency
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
pub(crate) const MACOS_WINDOW_ALPHA: f64 = 1.0;

/// Set window background to transparent at the given alpha level.
#[cfg(target_os = "macos")]
pub(crate) fn apply_macos_window_alpha(
    window: &tauri::WebviewWindow,
    alpha: f64,
) -> tauri::Result<()> {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};

    let ns_window = window.ns_window()? as *mut Object;
    unsafe {
        let _: () = msg_send![ns_window, setOpaque: false];
        let ns_color: *mut Object = msg_send![class!(NSColor), clearColor];
        let _: () = msg_send![ns_window, setBackgroundColor: ns_color];
        let _: () = msg_send![ns_window, setAlphaValue: alpha];
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Shared utility functions
// ---------------------------------------------------------------------------

/// Resolve the app-data directory, creating it if absent.
pub(crate) fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_data_dir().map_err(|err| err.to_string())?;
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|err| err.to_string())?;
    }
    Ok(path)
}

/// Current UTC time as milliseconds since UNIX epoch.
pub(crate) fn now_ms() -> Option<i64> {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?;
    i64::try_from(duration.as_millis()).ok()
}

/// Convert a `SystemTime` to milliseconds since UNIX epoch.
pub(crate) fn time_to_ms(time: std::time::SystemTime) -> Option<i64> {
    let duration = time.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(duration.as_millis()).ok()
}

/// Extract the parent folder portion of a relative note path.
pub(crate) fn note_parent_folder_path(note_rel: &str) -> String {
    note_rel
        .rsplit_once('/')
        .map(|(parent, _)| parent.to_string())
        .unwrap_or_default()
}

/// Decode a base64 data-URI payload, stripping any `data:...;base64,` prefix.
pub(crate) fn decode_base64_payload(payload: &str, kind: &str) -> Result<Vec<u8>, String> {
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
pub(crate) fn decode_audio_base64(payload: &str) -> Result<Vec<u8>, String> {
    decode_base64_payload(payload, "Audio")
}

/// Decode base64-encoded image bytes.
pub(crate) fn decode_image_base64(payload: &str) -> Result<Vec<u8>, String> {
    decode_base64_payload(payload, "Image")
}

/// Format an HTTP error response with status code and body.
pub(crate) fn response_error(status: reqwest::StatusCode, body: String, context: &str) -> String {
    let compact = body.replace('\n', " ");
    if compact.trim().is_empty() {
        format!("{} failed (HTTP {}).", context, status)
    } else {
        format!("{} failed (HTTP {}): {}", context, status, compact)
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[cfg_attr(
    any(target_os = "ios", target_os = "android"),
    tauri::mobile_entry_point
)]
pub fn run() {
    commands::run();
}
