//! Working folders ("profiles") + device-local app config, mirroring the
//! desktop `commands/profiles.rs` surface. Every call returns the full
//! JSON `NotesProfilesSnapshot` so the host can refresh its state in one go.

use type_core::{
    application::profiles::ProfilesUseCases, CreateProfileArgs, DeleteProfileArgs,
    ProfilesAdapter, SetActiveProfileArgs, SetProfileNotesRootArgs, UpdateAppConfigArgs,
    UpdateProfileArgs, UpdateProfileSettingsArgs,
};

use crate::{from_json, run_blocking, to_json, unlocked_env, CoreError};

fn profiles_use_cases() -> Result<ProfilesUseCases<ProfilesAdapter>, String> {
    Ok(ProfilesUseCases::new(ProfilesAdapter::new(unlocked_env()?)))
}

/// All working folders + app config as JSON (`NotesProfilesSnapshot`).
#[uniffi::export(async_runtime = "tokio")]
pub async fn get_profiles() -> Result<String, CoreError> {
    run_blocking(|| to_json(&profiles_use_cases()?.list()?)).await
}

/// `args_json`: `CreateProfileArgs` (`name`, optional `description`).
#[uniffi::export(async_runtime = "tokio")]
pub async fn create_profile(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: CreateProfileArgs = from_json(&args_json)?;
        to_json(&profiles_use_cases()?.create(args)?)
    })
    .await
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn set_active_profile(profile_id: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args = SetActiveProfileArgs { profile_id };
        to_json(&profiles_use_cases()?.set_active(args)?)
    })
    .await
}

/// Point a working folder at a different directory (absolute path, e.g. a
/// user-visible location in Files). Existing content is moved over.
#[uniffi::export(async_runtime = "tokio")]
pub async fn set_profile_notes_root(
    profile_id: String,
    notes_root: String,
) -> Result<String, CoreError> {
    run_blocking(move || {
        let args = SetProfileNotesRootArgs {
            profile_id,
            notes_root,
        };
        to_json(&profiles_use_cases()?.set_notes_root(args)?)
    })
    .await
}

/// `args_json`: `UpdateProfileArgs` (`profile_id`, optional `name`/`description`).
#[uniffi::export(async_runtime = "tokio")]
pub async fn update_profile(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: UpdateProfileArgs = from_json(&args_json)?;
        to_json(&profiles_use_cases()?.update(args)?)
    })
    .await
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn delete_profile(profile_id: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args = DeleteProfileArgs { profile_id };
        to_json(&profiles_use_cases()?.delete(args)?)
    })
    .await
}

/// `args_json`: `UpdateProfileSettingsArgs` (`profile_id` + the folder's
/// `settings`, persisted to `.type/settings.json` inside its notes root).
#[uniffi::export(async_runtime = "tokio")]
pub async fn update_profile_settings(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: UpdateProfileSettingsArgs = from_json(&args_json)?;
        to_json(&profiles_use_cases()?.update_settings(args)?)
    })
    .await
}

/// `args_json`: `UpdateAppConfigArgs` (`config` — device-local secrets like
/// API keys, stored in app data, never inside a synced notes root).
#[uniffi::export(async_runtime = "tokio")]
pub async fn update_app_config(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: UpdateAppConfigArgs = from_json(&args_json)?;
        to_json(&profiles_use_cases()?.update_app_config(args)?)
    })
    .await
}

/// Zip every working folder into app data. Returns JSON `ProfilesBackupArchive`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn create_profiles_backup_zip() -> Result<String, CoreError> {
    run_blocking(|| to_json(&profiles_use_cases()?.create_backup()?)).await
}

/// Copy every working folder into the documents dir passed to `init_core`.
/// Returns JSON `ProfilesDocumentsExport`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn export_profiles_to_documents() -> Result<String, CoreError> {
    run_blocking(|| to_json(&profiles_use_cases()?.export_to_documents()?)).await
}
