//! Profile management: multi-profile support, migration from legacy sessions format.
//!
//! Split into focused submodules. This hub holds the shared constants + DTO
//! types and the app-data path resolvers, then re-exports each submodule so the
//! crate-root profiles surface is flat.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::app_data_dir;
use crate::ports::profiles::ProfilesGateway;

mod backup;
mod settings;
mod state;

pub(crate) use backup::*;
pub(crate) use settings::*;
pub(crate) use state::*;

pub(crate) use crate::ports::profiles::{ProfilesBackupArchive, ProfilesDocumentsExport};

/// Tauri-backed profile gateway. It owns app-data path resolution and profile
/// state persistence while application code works through the port.
pub(crate) struct TauriProfilesAdapter {
    app: tauri::AppHandle,
}

impl TauriProfilesAdapter {
    pub(crate) fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl ProfilesGateway for TauriProfilesAdapter {
    type Snapshot = NotesProfilesSnapshot;
    type CreateArgs = CreateProfileArgs;
    type SetActiveArgs = SetActiveProfileArgs;
    type SetNotesRootArgs = SetProfileNotesRootArgs;
    type UpdateArgs = UpdateProfileArgs;
    type DeleteArgs = DeleteProfileArgs;
    type UpdateSettingsArgs = UpdateProfileSettingsArgs;
    type UpdateAppConfigArgs = UpdateAppConfigArgs;
    type Backup = ProfilesBackupArchive;
    type Export = ProfilesDocumentsExport;

    fn list(&self) -> Result<Self::Snapshot, String> {
        let state =
            ensure_profiles_state(&self.app).or_else(|_| default_profiles_state(&self.app))?;
        Ok(profiles_snapshot(&self.app, &state))
    }

    fn create(&self, args: Self::CreateArgs) -> Result<Self::Snapshot, String> {
        let state = create_profile_state(&self.app, &args.name, args.description.as_deref())?;
        Ok(profiles_snapshot(&self.app, &state))
    }

    fn set_active(&self, args: Self::SetActiveArgs) -> Result<Self::Snapshot, String> {
        let state = set_active_profile_state(&self.app, &args.profile_id)?;
        Ok(profiles_snapshot(&self.app, &state))
    }

    fn set_notes_root(&self, args: Self::SetNotesRootArgs) -> Result<Self::Snapshot, String> {
        let state = set_profile_notes_root_state(&self.app, &args.profile_id, &args.notes_root)?;
        Ok(profiles_snapshot(&self.app, &state))
    }

    fn update(&self, args: Self::UpdateArgs) -> Result<Self::Snapshot, String> {
        let state = update_profile_state(
            &self.app,
            &args.profile_id,
            args.name.as_deref(),
            args.description.as_deref(),
        )?;
        Ok(profiles_snapshot(&self.app, &state))
    }

    fn delete(&self, args: Self::DeleteArgs) -> Result<Self::Snapshot, String> {
        let state = delete_profile_state(&self.app, &args.profile_id)?;
        Ok(profiles_snapshot(&self.app, &state))
    }

    fn update_settings(&self, args: Self::UpdateSettingsArgs) -> Result<Self::Snapshot, String> {
        let state = ensure_profiles_state(&self.app)?;
        let profile = find_profile(&state, &args.profile_id)
            .ok_or_else(|| format!("Profile not found: {}", args.profile_id))?;
        save_profile_settings(Path::new(&profile.notes_root), &args.settings.into())?;
        Ok(profiles_snapshot(&self.app, &state))
    }

    fn update_app_config(&self, args: Self::UpdateAppConfigArgs) -> Result<Self::Snapshot, String> {
        let app_data = app_data_dir(&self.app)?;
        save_app_config(&app_data, &args.config.into())?;
        let state = ensure_profiles_state(&self.app)?;
        Ok(profiles_snapshot(&self.app, &state))
    }

    fn create_backup(&self) -> Result<Self::Backup, String> {
        create_profiles_backup_zip_impl(&self.app)
    }

    fn export_to_documents(&self) -> Result<Self::Export, String> {
        export_profiles_to_documents_impl(&self.app)
    }
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PROFILES_FILE: &str = ".notes-profiles.json";
const LEGACY_PROFILES_FILE: &str = ".notes-sessions.json";

// ── Types ──────────────────────────────────────────────────────────────────────

/// Single profile entry with a unique id and notes root directory.
#[derive(Clone, Deserialize, PartialEq, Serialize)]
pub(crate) struct NotesProfileEntry {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) description: String,
    pub(crate) notes_root: String,
}

/// Persisted profiles state (active id + list of profiles).
#[derive(Clone, Default, Deserialize, PartialEq, Serialize)]
pub(crate) struct NotesProfilesFile {
    #[serde(default)]
    pub(crate) active_profile_id: String,
    #[serde(default)]
    pub(crate) profiles: Vec<NotesProfileEntry>,
}

/// Legacy sessions file shape used before the profiles rename.
#[derive(Clone, Default, Deserialize)]
struct LegacyProfilesMigrationFile {
    #[serde(default, rename = "active_session_id")]
    active_profile_id: String,
    #[serde(default, rename = "sessions")]
    profiles: Vec<NotesProfileEntry>,
}

/// Snapshot returned to the frontend.
#[derive(Serialize)]
pub(crate) struct NotesProfilesSnapshot {
    pub(crate) active_profile_id: String,
    pub(crate) profiles: Vec<NotesProfileEntryWithSettings>,
    pub(crate) app_config: crate::ports::profiles::AppConfig,
}

#[derive(Serialize)]
pub(crate) struct NotesProfileEntryWithSettings {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) notes_root: String,
    pub(crate) settings: crate::ports::profiles::ProfileSettings,
}

/// Arguments for creating a new profile.
#[derive(Deserialize)]
pub(crate) struct CreateProfileArgs {
    pub(crate) name: String,
    pub(crate) description: Option<String>,
}

/// Arguments for switching the active profile.
#[derive(Deserialize)]
pub(crate) struct SetActiveProfileArgs {
    pub(crate) profile_id: String,
}

/// Arguments for changing a profile's notes root directory.
#[derive(Deserialize)]
pub(crate) struct SetProfileNotesRootArgs {
    pub(crate) profile_id: String,
    pub(crate) notes_root: String,
}

/// Arguments for updating a profile's name or description.
#[derive(Deserialize)]
pub(crate) struct UpdateProfileArgs {
    pub(crate) profile_id: String,
    pub(crate) name: Option<String>,
    pub(crate) description: Option<String>,
}

/// Arguments for deleting a profile.
#[derive(Deserialize)]
pub(crate) struct DeleteProfileArgs {
    pub(crate) profile_id: String,
}

/// Arguments for updating a profile's settings.
#[derive(Deserialize)]
pub(crate) struct UpdateProfileSettingsArgs {
    pub(crate) profile_id: String,
    pub(crate) settings: crate::ports::profiles::ProfileSettings,
}

/// Arguments for updating global app config.
#[derive(Deserialize)]
pub(crate) struct UpdateAppConfigArgs {
    pub(crate) config: crate::ports::profiles::AppConfig,
}

impl From<crate::ports::profiles::ProfileSettings> for ProfileSettings {
    fn from(s: crate::ports::profiles::ProfileSettings) -> Self {
        Self {
            git_remote_url: s.git_remote_url,
            git_branch: s.git_branch,
            git_username: s.git_username,
            git_password: s.git_password,
            git_commit_message: s.git_commit_message,
            mobile_auto_transcription_enabled: s.mobile_auto_transcription_enabled,
            mobile_auto_handwriting_ocr_enabled: s.mobile_auto_handwriting_ocr_enabled,
        }
    }
}

impl From<ProfileSettings> for crate::ports::profiles::ProfileSettings {
    fn from(s: ProfileSettings) -> Self {
        Self {
            git_remote_url: s.git_remote_url,
            git_branch: s.git_branch,
            git_username: s.git_username,
            git_password: s.git_password,
            git_commit_message: s.git_commit_message,
            mobile_auto_transcription_enabled: s.mobile_auto_transcription_enabled,
            mobile_auto_handwriting_ocr_enabled: s.mobile_auto_handwriting_ocr_enabled,
        }
    }
}

impl From<crate::ports::profiles::AppConfig> for AppConfig {
    fn from(c: crate::ports::profiles::AppConfig) -> Self {
        Self {
            assemblyai_api_key: c.assemblyai_api_key,
            whisper_model: c.whisper_model,
            handwriting_ocr_provider: c.handwriting_ocr_provider,
            openai_api_key: c.openai_api_key,
            openai_model: c.openai_model,
            huggingface_api_key: c.huggingface_api_key,
            huggingface_model: c.huggingface_model,
            note_file_name_format: c.note_file_name_format,
        }
    }
}

impl From<AppConfig> for crate::ports::profiles::AppConfig {
    fn from(c: AppConfig) -> Self {
        Self {
            assemblyai_api_key: c.assemblyai_api_key,
            whisper_model: c.whisper_model,
            handwriting_ocr_provider: c.handwriting_ocr_provider,
            openai_api_key: c.openai_api_key,
            openai_model: c.openai_model,
            huggingface_api_key: c.huggingface_api_key,
            huggingface_model: c.huggingface_model,
            note_file_name_format: c.note_file_name_format,
        }
    }
}

/// Convert internal profiles state to the frontend-facing snapshot.
pub(crate) fn profiles_snapshot(
    app: &tauri::AppHandle,
    state: &NotesProfilesFile,
) -> NotesProfilesSnapshot {
    let app_data = app_data_dir(app).unwrap_or_default();
    let app_config = load_app_config(&app_data);

    let profiles = state
        .profiles
        .iter()
        .map(|p| {
            let settings = load_profile_settings(Path::new(&p.notes_root));
            NotesProfileEntryWithSettings {
                id: p.id.clone(),
                name: p.name.clone(),
                description: p.description.clone(),
                notes_root: p.notes_root.clone(),
                settings: settings.into(),
            }
        })
        .collect();

    NotesProfilesSnapshot {
        active_profile_id: state.active_profile_id.clone(),
        profiles,
        app_config: app_config.into(),
    }
}

// ── Paths ──────────────────────────────────────────────────────────────────────

/// Path to the profiles JSON file in app data.
pub(crate) fn profiles_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(PROFILES_FILE))
}

/// Path to the legacy sessions file (pre-rename migration source).
pub(crate) fn legacy_profiles_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(LEGACY_PROFILES_FILE))
}

/// Per-profile notes root derived from app data dir.
pub(crate) fn profile_root_for_id(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("profiles").join(id).join("notes"))
}
