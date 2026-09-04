mod app_icon;
mod git_sync;
mod handwriting;
mod import;
mod local_sync;
mod notes;
mod profiles;
mod recordings;
mod security;

#[cfg(target_os = "macos")]
use tauri::Manager;

pub(crate) async fn run_blocking_command<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| error.to_string())?
}

pub(super) fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Native desktop auto-updater (replaces the whole app binary).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|_app| {
            let app_handle = _app.handle();
            type_core::ensure_security_runtime_initialized_for_setup(&crate::app_env(app_handle)?)?;
            // A phone push lands in the notes working tree behind the
            // frontend's back — bridge the core's notification into a Tauri
            // event so the notes tree refreshes with the incoming notes.
            {
                use tauri::Emitter;
                let push_handle = app_handle.clone();
                type_core::set_local_sync_push_listener(Box::new(move || {
                    let _ = push_handle.emit("local-sync-push-received", ());
                }));
            }
            let auto_start_env = crate::app_env(app_handle)?;
            if type_core::local_sync_auto_start_enabled(&auto_start_env) {
                std::thread::spawn(move || {
                    if type_core::ensure_security_unlocked_for_app(&auto_start_env).is_ok() {
                        if let Err(error) = type_core::start_local_sync_server_impl(&auto_start_env)
                        {
                            eprintln!("[local-sync] automatic startup failed: {error}");
                        }
                    }
                });
            }
            if let Err(error) = crate::sync_recordings_asset_scope(app_handle) {
                eprintln!(
                    "[recordings] failed to set initial asset-protocol scope: {}",
                    error
                );
            }
            #[cfg(target_os = "macos")]
            if let Some(window) = _app.get_webview_window("main") {
                let _ = crate::apply_macos_window_alpha(&window, crate::MACOS_WINDOW_ALPHA);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_icon::set_app_icon,
            security::get_security_state,
            security::enable_security,
            security::lock_security,
            security::unlock_security,
            security::set_security_preferences,
            profiles::get_profiles,
            profiles::create_profile,
            profiles::set_active_profile,
            profiles::set_profile_notes_root,
            profiles::update_profile,
            profiles::delete_profile,
            profiles::update_profile_settings,
            profiles::update_app_config,
            profiles::create_profiles_backup_zip,
            profiles::export_profiles_to_documents,
            notes::get_tree,
            notes::read_note,
            notes::create_note,
            notes::write_note,
            notes::set_note_timestamp,
            notes::update_note_markers,
            notes::get_note_meta,
            notes::list_note_previews,
            notes::move_items,
            notes::delete_items,
            notes::rename_item,
            notes::set_order,
            recordings::save_audio_recording,
            recordings::queue_recording_transcriptions,
            recordings::queue_local_transcriptions,
            recordings::retrigger_transcription,
            recordings::check_whisper_status,
            recordings::list_recordings,
            recordings::read_recording_audio,
            recordings::resolve_recording_audio_path,
            recordings::import_audio_files,
            recordings::audio_import_status,
            handwriting::save_handwriting_attachment,
            handwriting::queue_handwriting_ocr,
            handwriting::list_handwriting_ocr_jobs,
            handwriting::check_local_ocr_status,
            import::scan_apple_notes_folder,
            import::start_apple_notes_import,
            import::apple_import_status,
            git_sync::generate_ssh_key,
            git_sync::get_ssh_public_key,
            git_sync::delete_ssh_key,
            git_sync::get_git_status,
            git_sync::get_git_sync_progress,
            git_sync::get_git_history,
            git_sync::connect_git_repo,
            git_sync::git_pull,
            git_sync::git_commit,
            git_sync::git_push,
            local_sync::get_local_sync_server_status,
            local_sync::start_local_sync_server,
            local_sync::stop_local_sync_server,
            local_sync::discover_local_sync_servers,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // On macOS the red close button means "hide the window", not "stop
        // direct sync". Keep the Tauri process (and therefore SSH + Iroh)
        // resident, and restore the same window when the Dock icon is opened.
        // Cmd-Q still emits Exit and performs the normal clean shutdown.
        #[cfg(target_os = "macos")]
        match &event {
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
                api.prevent_close();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            tauri::RunEvent::Reopen { .. } => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        }
        // Tear down the local sync git daemon when the app exits so we never
        // leave an orphaned process holding port 9418.
        if matches!(event, tauri::RunEvent::Exit) {
            type_core::shutdown_local_sync_server();
        }
    });
}
