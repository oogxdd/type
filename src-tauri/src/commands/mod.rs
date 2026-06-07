mod git_sync;
mod handwriting;
mod import;
mod local_sync;
mod notes;
mod platform;
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
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_ota::init());

    // Native desktop auto-updater (replaces the whole app binary). Not available
    // on mobile, so it is only registered for desktop targets. iOS keeps using
    // the OTA JS-bundle plugin above.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    let app = builder
        .setup(|_app| {
            let app_handle = _app.handle();
            crate::ensure_security_runtime_initialized_for_setup(&app_handle)?;
            #[cfg(target_os = "macos")]
            if let Some(window) = _app.get_webview_window("main") {
                let _ = crate::apply_macos_window_alpha(&window, crate::MACOS_WINDOW_ALPHA);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            security::get_security_state,
            security::enable_security,
            security::lock_security,
            security::unlock_security,
            security::set_security_preferences,
            platform::set_native_theme,
            platform::present_file_export_sheet,
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
            notes::get_note_meta,
            notes::move_items,
            notes::delete_items,
            notes::rename_item,
            notes::set_order,
            recordings::native_audio_recorder_capabilities,
            recordings::start_native_audio_recording,
            recordings::stop_native_audio_recording,
            recordings::save_audio_recording,
            recordings::queue_recording_transcriptions,
            recordings::queue_local_transcriptions,
            recordings::retrigger_transcription,
            recordings::check_whisper_status,
            recordings::list_recordings,
            recordings::read_recording_audio,
            handwriting::save_handwriting_attachment,
            handwriting::queue_handwriting_ocr,
            handwriting::list_handwriting_ocr_jobs,
            import::scan_apple_notes_folder,
            import::start_apple_notes_import,
            import::apple_import_status,
            git_sync::generate_ssh_key,
            git_sync::get_ssh_public_key,
            git_sync::delete_ssh_key,
            git_sync::get_git_status,
            git_sync::get_git_history,
            git_sync::connect_git_repo,
            git_sync::git_pull,
            git_sync::git_push,
            local_sync::get_local_sync_server_status,
            local_sync::start_local_sync_server,
            local_sync::stop_local_sync_server,
            local_sync::discover_local_sync_servers,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "ios")]
        match event {
            tauri::RunEvent::Ready | tauri::RunEvent::Resumed => {
                crate::install_ios_webview_termination_recovery(app_handle);
            }
            tauri::RunEvent::Exit => {
                crate::release_ios_webview_termination_proxies();
            }
            _ => {}
        }

        // Tear down the local sync git daemon when the app exits so we never
        // leave an orphaned process holding port 9418.
        #[cfg(desktop)]
        {
            if matches!(event, tauri::RunEvent::Exit) {
                crate::shutdown_local_sync_server();
            }
            let _ = app_handle;
        }

        #[cfg(not(any(target_os = "ios", desktop)))]
        let _ = (app_handle, event);
    });
}
