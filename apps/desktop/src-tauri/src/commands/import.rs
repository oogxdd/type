use type_core::{
    application::import::ImportUseCases, ensure_security_unlocked_for_app, AppleImportArgs,
    AppleImportScan, AppleImportState, ImportAdapter,
};

fn import_use_cases(app: tauri::AppHandle) -> Result<ImportUseCases<ImportAdapter>, String> {
    Ok(ImportUseCases::new(ImportAdapter::new(crate::app_env(
        &app,
    )?)))
}

#[tauri::command]
pub(super) fn scan_apple_notes_folder(
    app: tauri::AppHandle,
    path: String,
) -> Result<AppleImportScan, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    import_use_cases(app)?.scan(&path)
}

#[tauri::command]
pub(super) fn start_apple_notes_import(
    app: tauri::AppHandle,
    args: AppleImportArgs,
) -> Result<(), String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    import_use_cases(app)?.start(args)
}

#[tauri::command]
pub(super) fn apple_import_status(app: tauri::AppHandle) -> Result<AppleImportState, String> {
    import_use_cases(app)?.status()
}
