use crate::*;

#[tauri::command]
pub(super) fn set_native_theme(app: tauri::AppHandle, theme: String) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        return set_ios_native_theme(&app, &theme);
    }

    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, theme);
        Ok(())
    }
}

#[tauri::command]
pub(super) fn present_file_export_sheet(
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    ensure_security_unlocked_for_app(&app)?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Export file path is required.".to_string());
    }

    #[cfg(target_os = "ios")]
    {
        let export_path = PathBuf::from(trimmed);
        return present_ios_file_export_sheet(&app, &export_path);
    }

    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Err("Native iOS file export is unavailable on this platform.".to_string())
    }
}
