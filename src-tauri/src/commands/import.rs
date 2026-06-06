use crate::*;
use std::path::Path;

/// Preview an exported Apple Notes folder before importing.
#[tauri::command]
pub(super) fn scan_apple_notes_folder(
    app: tauri::AppHandle,
    path: String,
) -> Result<AppleImportScan, String> {
    ensure_security_unlocked_for_app(&app)?;
    scan_apple_import_source(Path::new(path.trim()))
}

/// Kick off an Apple Notes import on a worker thread. Returns immediately; the
/// frontend polls `apple_import_status` for progress.
#[tauri::command]
pub(super) fn start_apple_notes_import(
    app: tauri::AppHandle,
    args: AppleImportArgs,
) -> Result<(), String> {
    ensure_security_unlocked_for_app(&app)?;
    let notes_root = ensured_notes_root(&app)?;

    // Resolve the destination label up front so the snapshot is meaningful the
    // instant the UI starts polling, and claim the single import slot.
    let target_label = match args.mode {
        AppleImportMode::Flatten => "Feed".to_string(),
        AppleImportMode::Preserve => args
            .target_folder
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| "Imported Notes".to_string()),
    };
    begin_apple_import(target_label)?;

    std::thread::spawn(move || {
        run_apple_notes_import(notes_root, args);
    });
    Ok(())
}

/// Poll the current/last import progress.
#[tauri::command]
pub(super) fn apple_import_status() -> Result<AppleImportState, String> {
    Ok(apple_import_snapshot())
}
