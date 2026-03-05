// Profile management: multi-profile support, migration from legacy sessions format.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use crate::{app_data_dir, ensure_system_folders};

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

#[derive(Deserialize)]
pub(crate) struct CreateProfileArgs {
    pub(crate) name: String,
    pub(crate) description: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct SetActiveProfileArgs {
    pub(crate) profile_id: String,
}

#[derive(Deserialize)]
pub(crate) struct SetProfileNotesRootArgs {
    pub(crate) profile_id: String,
    pub(crate) notes_root: String,
}

#[derive(Deserialize)]
pub(crate) struct UpdateProfileArgs {
    pub(crate) profile_id: String,
    pub(crate) name: Option<String>,
    pub(crate) description: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct DeleteProfileArgs {
    pub(crate) profile_id: String,
}

// ── Paths ──────────────────────────────────────────────────────────────────────

pub(crate) fn profiles_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(PROFILES_FILE))
}

pub(crate) fn legacy_profiles_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(LEGACY_PROFILES_FILE))
}

/// Per-profile notes root derived from app data dir.
pub(crate) fn profile_root_for_id(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("profiles").join(id).join("notes"))
}

// ── Private helpers ────────────────────────────────────────────────────────────

fn is_directory_empty(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(true);
    }
    let mut entries = fs::read_dir(path).map_err(|err| err.to_string())?;
    Ok(entries.next().is_none())
}

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
    if !to.exists() {
        fs::create_dir_all(to).map_err(|err| err.to_string())?;
    }
    for entry in fs::read_dir(from).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        let metadata = entry.metadata().map_err(|err| err.to_string())?;
        if metadata.is_dir() {
            copy_dir_recursive(&source, &target)?;
        } else if metadata.is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
            fs::copy(&source, &target).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

/// Move directory contents via rename, falling back to copy+delete.
fn move_dir_contents(source: &Path, destination: &Path) -> Result<(), String> {
    if source == destination {
        return Ok(());
    }
    if !source.exists() {
        fs::create_dir_all(destination).map_err(|err| err.to_string())?;
        return Ok(());
    }
    if destination.exists() {
        if !is_directory_empty(destination)? {
            return Err(format!(
                "Destination is not empty: {}",
                destination.to_string_lossy()
            ));
        }
    } else if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    if let Err(rename_error) = fs::rename(source, destination) {
        copy_dir_recursive(source, destination)?;
        fs::remove_dir_all(source).map_err(|err| {
            format!(
                "Failed to remove source after copy ({}): {}",
                source.to_string_lossy(),
                err
            )
        })?;
        println!(
            "[profiles] fallback copy used while moving profile root (rename failed: {})",
            rename_error
        );
    }
    Ok(())
}

/// Resolve the notes root using env vars / cwd / app data fallback.
pub(crate) fn legacy_notes_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("NOTES_ROOT") {
        let root = PathBuf::from(path);
        if root.exists() {
            return Ok(root);
        }
    }

    let cwd = std::env::current_dir().map_err(|err| err.to_string())?;
    let direct = cwd.join("notes");
    if direct.exists() {
        return Ok(direct);
    }
    let parent = cwd.join("..").join("notes");
    if parent.exists() {
        return Ok(parent);
    }

    let app_data = app_data_dir(app)?;
    let root = app_data.join("notes");
    if !root.exists() {
        fs::create_dir_all(&root).map_err(|err| err.to_string())?;
    }
    Ok(root)
}

fn normalize_profile_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        "Profile".to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_profile_description(description: &str) -> String {
    description.trim().to_string()
}

/// Generate a URL-safe id from a profile name.
fn slugify_profile_id(name: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in name.chars() {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            slug.push(lower);
            last_dash = false;
            continue;
        }
        if !last_dash && !slug.is_empty() {
            slug.push('-');
            last_dash = true;
        }
    }
    let compact = slug.trim_matches('-').to_string();
    if compact.is_empty() {
        "profile".to_string()
    } else {
        compact
    }
}

// ── State management ───────────────────────────────────────────────────────────

/// Build a default profiles state rooted at the legacy notes directory.
pub(crate) fn default_profiles_state(app: &tauri::AppHandle) -> Result<NotesProfilesFile, String> {
    let legacy_root = legacy_notes_root(app)?;
    if !legacy_root.exists() {
        fs::create_dir_all(&legacy_root).map_err(|err| err.to_string())?;
    }
    Ok(NotesProfilesFile {
        active_profile_id: "default".to_string(),
        profiles: vec![NotesProfileEntry {
            id: "default".to_string(),
            name: "Default".to_string(),
            description: String::new(),
            notes_root: legacy_root.to_string_lossy().to_string(),
        }],
    })
}

pub(crate) fn write_profiles_state(
    app: &tauri::AppHandle,
    state: &NotesProfilesFile,
) -> Result<(), String> {
    let path = profiles_file_path(app)?;
    let content = serde_json::to_string_pretty(state).map_err(|err| err.to_string())?;
    fs::write(path, content).map_err(|err| err.to_string())
}

/// Validate and normalize a profiles state: remove duplicates, fix empty roots.
pub(crate) fn normalize_profiles_state(
    app: &tauri::AppHandle,
    mut state: NotesProfilesFile,
) -> Result<NotesProfilesFile, String> {
    let mut seen = HashSet::new();
    let mut profiles = Vec::new();
    for mut profile in state.profiles.drain(..) {
        let id = profile.id.trim().to_string();
        if id.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        profile.id = id.clone();
        profile.name = normalize_profile_name(&profile.name);
        profile.description = normalize_profile_description(&profile.description);
        if profile.notes_root.trim().is_empty() {
            profile.notes_root = profile_root_for_id(app, &id)?.to_string_lossy().to_string();
        }
        let root = PathBuf::from(&profile.notes_root);
        if !root.exists() {
            fs::create_dir_all(&root).map_err(|err| err.to_string())?;
        }
        profiles.push(profile);
    }

    if profiles.is_empty() {
        return default_profiles_state(app);
    }

    let active_profile_id = if profiles
        .iter()
        .any(|profile| profile.id == state.active_profile_id)
    {
        state.active_profile_id
    } else {
        profiles[0].id.clone()
    };

    Ok(NotesProfilesFile {
        active_profile_id,
        profiles,
    })
}

fn migrate_legacy_profiles_state(state: LegacyProfilesMigrationFile) -> NotesProfilesFile {
    NotesProfilesFile {
        active_profile_id: state.active_profile_id,
        profiles: state.profiles,
    }
}

/// Load profiles from disk, migrating from legacy format if needed.
pub(crate) fn ensure_profiles_state(
    app: &tauri::AppHandle,
) -> Result<NotesProfilesFile, String> {
    let path = profiles_file_path(app)?;
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
        return match serde_json::from_str::<NotesProfilesFile>(&content) {
            Ok(parsed) => {
                let normalized = normalize_profiles_state(app, parsed.clone())?;
                if normalized != parsed {
                    write_profiles_state(app, &normalized)?;
                }
                Ok(normalized)
            }
            Err(_) => {
                let state = default_profiles_state(app)?;
                write_profiles_state(app, &state)?;
                Ok(state)
            }
        };
    }

    let legacy_path = legacy_profiles_file_path(app)?;
    if legacy_path.exists() {
        let content = fs::read_to_string(&legacy_path).map_err(|err| err.to_string())?;
        let migrated =
            if let Ok(parsed_profiles) = serde_json::from_str::<NotesProfilesFile>(&content) {
                parsed_profiles
            } else if let Ok(parsed_legacy) =
                serde_json::from_str::<LegacyProfilesMigrationFile>(&content)
            {
                migrate_legacy_profiles_state(parsed_legacy)
            } else {
                NotesProfilesFile::default()
            };
        if !migrated.profiles.is_empty() {
            let normalized = normalize_profiles_state(app, migrated)?;
            write_profiles_state(app, &normalized)?;
            let _ = fs::remove_file(&legacy_path);
            return Ok(normalized);
        }
    }

    let state = default_profiles_state(app)?;
    write_profiles_state(app, &state)?;
    Ok(state)
}

pub(crate) fn profiles_snapshot(state: &NotesProfilesFile) -> NotesProfilesSnapshot {
    NotesProfilesSnapshot {
        active_profile_id: state.active_profile_id.clone(),
        profiles: state.profiles.clone(),
    }
}

pub(crate) fn find_profile<'a>(
    state: &'a NotesProfilesFile,
    profile_id: &str,
) -> Option<&'a NotesProfileEntry> {
    state
        .profiles
        .iter()
        .find(|profile| profile.id == profile_id)
}

// ── Profile CRUD ───────────────────────────────────────────────────────────────

pub(crate) fn set_active_profile_state(
    app: &tauri::AppHandle,
    profile_id: &str,
) -> Result<NotesProfilesFile, String> {
    let mut state = ensure_profiles_state(app)?;
    let id = profile_id.trim();
    if id.is_empty() {
        return Err("Profile id is required.".to_string());
    }
    if find_profile(&state, id).is_none() {
        return Err(format!("Profile not found: {}", id));
    }
    state.active_profile_id = id.to_string();
    write_profiles_state(app, &state)?;
    Ok(state)
}

pub(crate) fn create_profile_state(
    app: &tauri::AppHandle,
    name: &str,
    description: Option<&str>,
) -> Result<NotesProfilesFile, String> {
    let mut state = ensure_profiles_state(app)?;
    let profile_name = normalize_profile_name(name);
    let base_id = slugify_profile_id(&profile_name);
    let existing: HashSet<String> = state
        .profiles
        .iter()
        .map(|profile| profile.id.clone())
        .collect();
    let mut profile_id = base_id.clone();
    let mut suffix = 2usize;
    while existing.contains(&profile_id) {
        profile_id = format!("{}-{}", base_id, suffix);
        suffix += 1;
    }

    let profile_root = profile_root_for_id(app, &profile_id)?;
    if !profile_root.exists() {
        fs::create_dir_all(&profile_root).map_err(|err| err.to_string())?;
    }

    state.profiles.push(NotesProfileEntry {
        id: profile_id.clone(),
        name: profile_name,
        description: normalize_profile_description(description.unwrap_or("")),
        notes_root: profile_root.to_string_lossy().to_string(),
    });
    state.active_profile_id = profile_id;
    write_profiles_state(app, &state)?;
    Ok(state)
}

pub(crate) fn update_profile_state(
    app: &tauri::AppHandle,
    profile_id: &str,
    name: Option<&str>,
    description: Option<&str>,
) -> Result<NotesProfilesFile, String> {
    let mut state = ensure_profiles_state(app)?;
    let id = profile_id.trim();
    if id.is_empty() {
        return Err("Profile id is required.".to_string());
    }
    let Some(index) = state.profiles.iter().position(|profile| profile.id == id) else {
        return Err(format!("Profile not found: {}", id));
    };
    if let Some(next_name) = name {
        state.profiles[index].name = normalize_profile_name(next_name);
    }
    if let Some(next_description) = description {
        state.profiles[index].description = normalize_profile_description(next_description);
    }
    write_profiles_state(app, &state)?;
    Ok(state)
}

pub(crate) fn delete_profile_state(
    app: &tauri::AppHandle,
    profile_id: &str,
) -> Result<NotesProfilesFile, String> {
    let mut state = ensure_profiles_state(app)?;
    let id = profile_id.trim();
    if id.is_empty() {
        return Err("Profile id is required.".to_string());
    }
    if state.profiles.len() <= 1 {
        return Err("At least one profile must remain.".to_string());
    }
    let Some(index) = state.profiles.iter().position(|profile| profile.id == id) else {
        return Err(format!("Profile not found: {}", id));
    };
    state.profiles.remove(index);
    if state.active_profile_id == id {
        let next_active = state
            .profiles
            .first()
            .ok_or_else(|| "At least one profile must remain.".to_string())?;
        state.active_profile_id = next_active.id.clone();
    }
    write_profiles_state(app, &state)?;
    Ok(state)
}

/// Validate and normalize an absolute notes root path.
pub(crate) fn normalize_notes_root_path(notes_root: &str) -> Result<PathBuf, String> {
    let trimmed = notes_root.trim();
    if trimmed.is_empty() {
        return Err("Profile notes root is required.".to_string());
    }
    let candidate = PathBuf::from(trimmed);
    if !candidate.is_absolute() {
        return Err("Profile notes root must be an absolute path.".to_string());
    }
    Ok(candidate)
}

/// Change a profile's notes root, moving existing content.
pub(crate) fn set_profile_notes_root_state(
    app: &tauri::AppHandle,
    profile_id: &str,
    notes_root: &str,
) -> Result<NotesProfilesFile, String> {
    let mut state = ensure_profiles_state(app)?;
    let id = profile_id.trim();
    if id.is_empty() {
        return Err("Profile id is required.".to_string());
    }
    let next_root = normalize_notes_root_path(notes_root)?;
    let Some(index) = state.profiles.iter().position(|profile| profile.id == id) else {
        return Err(format!("Profile not found: {}", id));
    };

    let current_root = PathBuf::from(state.profiles[index].notes_root.trim());
    if current_root != next_root {
        move_dir_contents(&current_root, &next_root)?;
    } else if !next_root.exists() {
        fs::create_dir_all(&next_root).map_err(|err| err.to_string())?;
    }
    ensure_system_folders(&next_root)?;

    state.profiles[index].notes_root = next_root.to_string_lossy().to_string();
    write_profiles_state(app, &state)?;
    Ok(state)
}
