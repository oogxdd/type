use serde::Serialize;

// ── Types ──────────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct ProfileEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub notes_root: String,
}

#[derive(Serialize)]
pub struct ProfilesSnapshot {
    pub active_profile_id: String,
    pub profiles: Vec<ProfileEntry>,
}

#[derive(Serialize)]
pub struct BackupArchive {
    pub archive_path: String,
    pub archive_name: String,
    pub profile_count: usize,
    pub file_count: usize,
    pub total_bytes: u64,
}

#[derive(Serialize)]
pub struct DocumentsExport {
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
    fn create_backup_zip(&self) -> Result<BackupArchive, String>;
    fn export_to_documents(&self) -> Result<DocumentsExport, String>;
}

/// Internal gateway used by profile application services. Persistence details
/// and Tauri path resolution remain in the concrete adapter.
pub(crate) trait ProfilesGateway {
    type Snapshot;
    type CreateArgs;
    type SetActiveArgs;
    type SetNotesRootArgs;
    type UpdateArgs;
    type DeleteArgs;
    type Backup;
    type Export;

    fn list(&self) -> Result<Self::Snapshot, String>;
    fn create(&self, args: Self::CreateArgs) -> Result<Self::Snapshot, String>;
    fn set_active(&self, args: Self::SetActiveArgs) -> Result<Self::Snapshot, String>;
    fn set_notes_root(&self, args: Self::SetNotesRootArgs) -> Result<Self::Snapshot, String>;
    fn update(&self, args: Self::UpdateArgs) -> Result<Self::Snapshot, String>;
    fn delete(&self, args: Self::DeleteArgs) -> Result<Self::Snapshot, String>;
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
