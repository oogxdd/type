use crate::*;

#[tauri::command]
pub(super) fn get_profiles(app: tauri::AppHandle) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&app)?;
    let state = ensure_profiles_state(&app).or_else(|_| default_profiles_state(&app))?;
    Ok(profiles_snapshot(&state))
}

#[tauri::command]
pub(super) fn create_profile(
    app: tauri::AppHandle,
    args: CreateProfileArgs,
) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&app)?;
    let state = create_profile_state(&app, &args.name, args.description.as_deref())?;
    Ok(profiles_snapshot(&state))
}

#[tauri::command]
pub(super) fn set_active_profile(
    app: tauri::AppHandle,
    args: SetActiveProfileArgs,
) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&app)?;
    let state = set_active_profile_state(&app, &args.profile_id)?;
    Ok(profiles_snapshot(&state))
}

#[tauri::command]
pub(super) fn set_profile_notes_root(
    app: tauri::AppHandle,
    args: SetProfileNotesRootArgs,
) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&app)?;
    let state = set_profile_notes_root_state(&app, &args.profile_id, &args.notes_root)?;
    Ok(profiles_snapshot(&state))
}

#[tauri::command]
pub(super) fn update_profile(
    app: tauri::AppHandle,
    args: UpdateProfileArgs,
) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&app)?;
    let state = update_profile_state(
        &app,
        &args.profile_id,
        args.name.as_deref(),
        args.description.as_deref(),
    )?;
    Ok(profiles_snapshot(&state))
}

#[tauri::command]
pub(super) fn delete_profile(
    app: tauri::AppHandle,
    args: DeleteProfileArgs,
) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&app)?;
    let state = delete_profile_state(&app, &args.profile_id)?;
    Ok(profiles_snapshot(&state))
}

#[tauri::command]
pub(super) async fn create_profiles_backup_zip(
    app: tauri::AppHandle,
) -> Result<ProfilesBackupArchive, String> {
    ensure_security_unlocked_for_app(&app)?;
    super::run_blocking_command(move || create_profiles_backup_zip_impl(&app)).await
}

#[tauri::command]
pub(super) async fn export_profiles_to_documents(
    app: tauri::AppHandle,
) -> Result<ProfilesDocumentsExport, String> {
    ensure_security_unlocked_for_app(&app)?;
    super::run_blocking_command(move || export_profiles_to_documents_impl(&app)).await
}
