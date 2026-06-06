//! Profile management: multi-profile support, migration from legacy sessions format.
//!
//! Split into focused submodules. This hub holds the shared constants + DTO
//! types and the app-data path resolvers, then re-exports each submodule so the
//! crate-root profiles surface is flat.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::app_data_dir;

mod backup;
mod state;

pub(crate) use backup::*;
pub(crate) use state::*;

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
    pub(crate) profiles: Vec<NotesProfileEntry>,
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

/// Result of creating a zip backup of all profiles.
#[derive(Serialize)]
pub(crate) struct ProfilesBackupArchive {
    pub(crate) archive_path: String,
    pub(crate) archive_name: String,
    pub(crate) profile_count: usize,
    pub(crate) file_count: usize,
    pub(crate) total_bytes: u64,
}

/// Result of exporting all profiles to the Documents directory.
#[derive(Serialize)]
pub(crate) struct ProfilesDocumentsExport {
    pub(crate) export_path: String,
    pub(crate) export_name: String,
    pub(crate) profile_count: usize,
    pub(crate) file_count: usize,
    pub(crate) total_bytes: u64,
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

