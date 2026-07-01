use crate::{
    application::platform::PlatformUseCases, ensure_security_unlocked_for_app, TauriPlatformAdapter,
};

fn platform_use_cases(app: tauri::AppHandle) -> PlatformUseCases<TauriPlatformAdapter> {
    PlatformUseCases::new(TauriPlatformAdapter::new(app))
}

#[tauri::command]
pub(super) fn set_native_theme(app: tauri::AppHandle, theme: String) -> Result<(), String> {
    platform_use_cases(app).set_native_theme(&theme)
}

#[tauri::command]
pub(super) fn present_file_export_sheet(app: tauri::AppHandle, path: String) -> Result<(), String> {
    ensure_security_unlocked_for_app(&app)?;
    platform_use_cases(app).present_file_export_sheet(&path)
}
