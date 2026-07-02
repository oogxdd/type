use serde::{Deserialize, Serialize};

// ── Types ──────────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct ProfileEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub notes_root: String,
    pub settings: ProfileSettings,
}

#[derive(Serialize)]
pub struct ProfilesSnapshot {
    pub active_profile_id: String,
    pub profiles: Vec<ProfileEntry>,
    pub app_config: AppConfig,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AppConfig {
    pub assemblyai_api_key: String,
    pub whisper_model: String,
    pub handwriting_ocr_provider: String,
    pub openai_api_key: String,
    pub openai_model: String,
    pub huggingface_api_key: String,
    pub huggingface_model: String,
    pub note_file_name_format: String,
}

/// Where recordings made in a working folder get transcribed.
///
/// Stored in the folder's own config (`.type/settings.json` inside the notes
/// root), so it syncs across devices with the notes themselves.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptionMode {
    /// Never transcribe automatically. Recordings stay `pending` until a user
    /// triggers transcription by hand.
    Off,
    /// Do not transcribe on this device class' capture path: phones leave
    /// recordings `pending` and a desktop picks them up after sync (its
    /// auto-queue loop scans for pending recordings and runs local Whisper).
    Desktop,
    /// Transcribe right away via the AssemblyAI cloud API (requires the
    /// device-local API key from the app config).
    #[serde(rename = "assemblyai")]
    AssemblyAi,
    /// Transcribe via a shell-registered `TranscriptionProvider` (e.g. a
    /// native on-device recognizer plugged in through the mobile FFI).
    Native,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ProfileSettings {
    pub git_remote_url: String,
    pub git_branch: String,
    pub git_username: String,
    pub git_password: String,
    pub git_commit_message: String,
    pub mobile_auto_transcription_enabled: bool,
    pub mobile_auto_handwriting_ocr_enabled: bool,
    /// `None` = not chosen yet; effective mode falls back to the legacy
    /// `mobile_auto_transcription_enabled` flag (true → AssemblyAi, false →
    /// Desktop).
    #[serde(default)]
    pub transcription_mode: Option<TranscriptionMode>,
}

#[derive(Serialize)]
pub struct ProfilesBackupArchive {
    pub archive_path: String,
    pub archive_name: String,
    pub profile_count: usize,
    pub file_count: usize,
    pub total_bytes: u64,
}

#[derive(Serialize)]
pub struct ProfilesDocumentsExport {
    pub export_path: String,
    pub export_name: String,
    pub profile_count: usize,
    pub file_count: usize,
    pub total_bytes: u64,
}

// ── Trait ──────────────────────────────────────────────────────────────────────

pub trait ProfileService {
    fn get_profiles(&self) -> Result<ProfilesSnapshot, String>;
    fn create_profile(
        &self,
        name: &str,
        description: Option<&str>,
    ) -> Result<ProfilesSnapshot, String>;
    fn set_active_profile(&self, profile_id: &str) -> Result<ProfilesSnapshot, String>;
    fn update_profile(
        &self,
        profile_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<ProfilesSnapshot, String>;
    fn delete_profile(&self, profile_id: &str) -> Result<ProfilesSnapshot, String>;
    fn set_profile_notes_root(
        &self,
        profile_id: &str,
        notes_root: &str,
    ) -> Result<ProfilesSnapshot, String>;
    fn update_profile_settings(
        &self,
        profile_id: &str,
        settings: ProfileSettings,
    ) -> Result<ProfilesSnapshot, String>;
    fn update_app_config(&self, config: AppConfig) -> Result<ProfilesSnapshot, String>;
    fn create_backup_zip(&self) -> Result<ProfilesBackupArchive, String>;
    fn export_to_documents(&self) -> Result<ProfilesDocumentsExport, String>;
}

/// Internal gateway used by profile application services. Persistence details
/// and Tauri path resolution remain in the concrete adapter.
pub trait ProfilesGateway {
    type Snapshot;
    type CreateArgs;
    type SetActiveArgs;
    type SetNotesRootArgs;
    type UpdateArgs;
    type DeleteArgs;
    type UpdateSettingsArgs;
    type UpdateAppConfigArgs;
    type Backup;
    type Export;

    fn list(&self) -> Result<Self::Snapshot, String>;
    fn create(&self, args: Self::CreateArgs) -> Result<Self::Snapshot, String>;
    fn set_active(&self, args: Self::SetActiveArgs) -> Result<Self::Snapshot, String>;
    fn set_notes_root(&self, args: Self::SetNotesRootArgs) -> Result<Self::Snapshot, String>;
    fn update(&self, args: Self::UpdateArgs) -> Result<Self::Snapshot, String>;
    fn delete(&self, args: Self::DeleteArgs) -> Result<Self::Snapshot, String>;
    fn update_settings(&self, args: Self::UpdateSettingsArgs) -> Result<Self::Snapshot, String>;
    fn update_app_config(&self, args: Self::UpdateAppConfigArgs) -> Result<Self::Snapshot, String>;
    fn create_backup(&self) -> Result<Self::Backup, String>;
    fn export_to_documents(&self) -> Result<Self::Export, String>;
}

// ─── Implementation Notes ─────────────────────────────────────────────────────
//
// ProfileService manages multiple isolated note collections ("profiles").
// Each profile has its own notes root directory and can be switched between.
//
// get_profiles()
//   in:  nothing
//   out: ProfilesSnapshot — active profile id + list of all profiles
//   - Loads from disk, migrates from legacy format if needed
//   - Normalizes: deduplicates, fixes empty roots, discovers orphaned profile directories
//   - Always returns at least one profile ("default")
//
// create_profile(name, description)
//   in:  name — display name for the profile
//        description — optional description text
//   out: ProfilesSnapshot — updated state with the new profile active
//   - Generates a URL-safe id from the name (e.g. "Work Notes" → "work-notes")
//   - Appends a suffix if the id already exists (e.g. "work-notes-2")
//   - Creates the notes root directory under app_data/profiles/{id}/notes/
//   - Sets the new profile as active
//
// set_active_profile(profile_id)
//   in:  profile_id — id of the profile to switch to
//   out: ProfilesSnapshot — updated state
//   - Fails if the profile doesn't exist
//
// update_profile(profile_id, name, description)
//   in:  profile_id — id of the profile to update
//        name — new display name (optional, keeps current if None)
//        description — new description (optional, keeps current if None)
//   out: ProfilesSnapshot — updated state
//
// delete_profile(profile_id)
//   in:  profile_id — id of the profile to remove
//   out: ProfilesSnapshot — updated state
//   - At least one profile must remain (fails otherwise)
//   - If the deleted profile was active, switches to the first remaining profile
//   - Does NOT delete the notes root directory (data preservation)
//
// set_profile_notes_root(profile_id, notes_root)
//   in:  profile_id — id of the profile to update
//        notes_root — absolute path to the new notes directory
//   out: ProfilesSnapshot — updated state
//   - Must be an absolute path
//   - Moves existing content from the old root to the new root
//   - Falls back to copy+delete if rename fails (cross-device moves)
//   - Creates system folders in the new root
//
// create_backup_zip()
//   in:  nothing
//   out: BackupArchive — path, name, profile count, file count, total bytes
//   - Creates a .zip archive in app_data/exports/
//   - Contains profiles-state.json + all notes from all profiles
//   - Each profile stored under profiles/{index}-{id}/notes/
//
// export_to_documents()
//   in:  nothing
//   out: DocumentsExport — path, name, profile count, file count, total bytes
//   - Copies all profiles to Documents/Type Export/{timestamp}/
//   - Includes profiles state, security config, and all note files
//
// Key assumptions for any implementation:
//   - Profile state is persisted as JSON (.notes-profiles.json in app data)
//   - Profile ids are URL-safe slugs derived from the name
//   - Each profile has an isolated notes root directory
//   - At least one profile must always exist
//   - Timestamps in filenames are Unix milliseconds
