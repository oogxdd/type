// Tauri shell around the framework-free `type-core` crate.
//
// The core (domain/application/ports + filesystem/git/crypto adapters) lives in
// crates/type-core and knows nothing about Tauri. This crate contributes:
//   - the #[tauri::command] IPC layer (commands/)
//   - `app_env()`, which maps a tauri::AppHandle onto core's `AppEnv`
//   - macOS window transparency via Objective-C interop

mod commands;

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
