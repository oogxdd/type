// Tauri shell around the framework-free `type-core` crate.
//
// The core (domain/application/ports + filesystem/git/crypto adapters) lives in
// crates/type-core and knows nothing about Tauri. This crate contributes:
//   - the #[tauri::command] IPC layer (commands/)
//   - `app_env()`, which maps a tauri::AppHandle onto core's `AppEnv`
//   - macOS window transparency via Objective-C interop

mod commands;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

// ---------------------------------------------------------------------------
// AppEnv bridge
// ---------------------------------------------------------------------------

/// Build the core `AppEnv` from a Tauri app handle.
pub(crate) fn app_env(app: &tauri::AppHandle) -> Result<type_core::AppEnv, String> {
    let app_data = app.path().app_data_dir().map_err(|err| err.to_string())?;
    let mut env = type_core::AppEnv::new(app_data);
    if let Ok(documents) = app.path().document_dir() {
        env = env.with_documents_dir(documents);
    }
    Ok(env)
}

// ---------------------------------------------------------------------------
// Asset protocol scope
// ---------------------------------------------------------------------------

/// The one directory the `asset://` protocol is ever allowed to serve:
/// the active profile's `Recordings/` folder. Recordings are unencrypted on
/// disk (encryption only covers note bodies), so this is exactly as exposed
/// as the base64 IPC read it replaces — no more, no less. Re-synced whenever
/// the active profile / notes_root can change (app start, profile switch,
/// profile create/delete, notes_root move) so a stale profile's folder is
/// revoked rather than left reachable forever.
static LAST_GRANTED_RECORDINGS_SCOPE: Mutex<Option<PathBuf>> = Mutex::new(None);

pub(crate) fn sync_recordings_asset_scope(app: &tauri::AppHandle) -> Result<(), String> {
    let env = app_env(app)?;
    let root = type_core::notes_root(&env)?;
    let recordings_dir = root.join(type_core::RECORDINGS_STORAGE_FOLDER);

    let scope = app.asset_protocol_scope();
    let mut last = LAST_GRANTED_RECORDINGS_SCOPE
        .lock()
        .map_err(|err| err.to_string())?;
    if let Some(previous) = last.as_ref() {
        if previous != &recordings_dir {
            let _ = scope.forbid_directory(previous, true);
        }
    }
    scope
        .allow_directory(&recordings_dir, true)
        .map_err(|err| err.to_string())?;
    *last = Some(recordings_dir);
    Ok(())
}

// ---------------------------------------------------------------------------
// macOS window transparency
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
pub(crate) const MACOS_WINDOW_ALPHA: f64 = 1.0;

/// Set window background to transparent at the given alpha level.
#[allow(unexpected_cfgs)]
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
// Entry point
// ---------------------------------------------------------------------------

pub fn run() {
    commands::run();
}
