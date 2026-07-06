use type_core::{
    application::profiles::ProfilesUseCases, ensure_security_unlocked_for_app, CreateProfileArgs,
    DeleteProfileArgs, NotesProfilesSnapshot, ProfilesBackupArchive, ProfilesDocumentsExport,
    SetActiveProfileArgs, SetProfileNotesRootArgs, ProfilesAdapter, UpdateAppConfigArgs,
    UpdateProfileArgs, UpdateProfileSettingsArgs,
};

fn profiles_use_cases(app: tauri::AppHandle) -> Result<ProfilesUseCases<ProfilesAdapter>, String> {
    Ok(ProfilesUseCases::new(ProfilesAdapter::new(crate::app_env(&app)?)))
}

#[tauri::command]
pub(super) fn get_profiles(app: tauri::AppHandle) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    profiles_use_cases(app)?.list()
}

#[tauri::command]
pub(super) fn create_profile(
    app: tauri::AppHandle,
    args: CreateProfileArgs,
) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    let result = profiles_use_cases(app.clone())?.create(args)?;
    sync_recordings_scope_after_profile_change(&app);
    Ok(result)
}

#[tauri::command]
pub(super) fn set_active_profile(
    app: tauri::AppHandle,
    args: SetActiveProfileArgs,
) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    let result = profiles_use_cases(app.clone())?.set_active(args)?;
    sync_recordings_scope_after_profile_change(&app);
    Ok(result)
}

#[tauri::command]
pub(super) fn set_profile_notes_root(
    app: tauri::AppHandle,
    args: SetProfileNotesRootArgs,
) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    let result = profiles_use_cases(app.clone())?.set_notes_root(args)?;
    sync_recordings_scope_after_profile_change(&app);
    Ok(result)
}

#[tauri::command]
pub(super) fn update_profile(
    app: tauri::AppHandle,
    args: UpdateProfileArgs,
) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    profiles_use_cases(app)?.update(args)
}

#[tauri::command]
pub(super) fn delete_profile(
    app: tauri::AppHandle,
    args: DeleteProfileArgs,
) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    let result = profiles_use_cases(app.clone())?.delete(args)?;
    sync_recordings_scope_after_profile_change(&app);
    Ok(result)
}

/// The active profile (and therefore notes_root) may have changed — re-grant
/// the asset:// protocol to only the new active profile's Recordings folder.
/// Best-effort: a failure here shouldn't fail the profile operation itself.
fn sync_recordings_scope_after_profile_change(app: &tauri::AppHandle) {
    if let Err(error) = crate::sync_recordings_asset_scope(app) {
        eprintln!(
            "[recordings] failed to update asset-protocol scope after profile change: {}",
            error
        );
    }
}

#[tauri::command]
pub(super) fn update_profile_settings(
    app: tauri::AppHandle,
    args: UpdateProfileSettingsArgs,
) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    profiles_use_cases(app)?.update_settings(args)
}

#[tauri::command]
pub(super) fn update_app_config(
    app: tauri::AppHandle,
    args: UpdateAppConfigArgs,
) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    profiles_use_cases(app)?.update_app_config(args)
}

#[tauri::command]
pub(super) async fn create_profiles_backup_zip(
    app: tauri::AppHandle,
) -> Result<ProfilesBackupArchive, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || profiles_use_cases(app)?.create_backup()).await
}

#[tauri::command]
pub(super) async fn export_profiles_to_documents(
    app: tauri::AppHandle,
) -> Result<ProfilesDocumentsExport, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    super::run_blocking_command(move || profiles_use_cases(app)?.export_to_documents()).await
}
