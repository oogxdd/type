//! Profile management: multi-profile support, migration from legacy sessions format.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::Manager;
use zip::write::FileOptions;

use crate::{app_data_dir, ensure_system_folders, now_ms};

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

fn sanitize_archive_segment(raw: &str, fallback: &str) -> String {
    let mut sanitized = String::new();
    let mut previous_dash = false;
    for ch in raw.trim().chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            sanitized.push(ch.to_ascii_lowercase());
            previous_dash = false;
        } else if !previous_dash && !sanitized.is_empty() {
            sanitized.push('-');
            previous_dash = true;
        }
    }
    let compact = sanitized.trim_matches('-').to_string();
    if compact.is_empty() {
        fallback.to_string()
    } else {
        compact
    }
}

fn join_zip_path(parent: &str, child: &str) -> String {
    if parent.is_empty() {
        child.to_string()
    } else {
        format!("{}/{}", parent.trim_end_matches('/'), child)
    }
}

fn add_path_to_zip(
    zip: &mut zip::ZipWriter<fs::File>,
    source_path: &Path,
    zip_path: &str,
    file_count: &mut usize,
    total_bytes: &mut u64,
) -> Result<(), String> {
    let file_metadata = fs::symlink_metadata(source_path).map_err(|error| {
        format!(
            "Failed to read metadata for {}: {}",
            source_path.to_string_lossy(),
            error
        )
    })?;
    if file_metadata.file_type().is_symlink() {
        return Ok(());
    }

    let file_options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    let directory_options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .unix_permissions(0o755);

    let normalized_zip_path = zip_path.replace('\\', "/");
    if file_metadata.is_dir() {
        let mut directory_entry = normalized_zip_path.trim_end_matches('/').to_string();
        if !directory_entry.is_empty() {
            directory_entry.push('/');
            zip.add_directory(&directory_entry, directory_options)
                .map_err(|error| error.to_string())?;
        }
        let mut entries = fs::read_dir(source_path)
            .map_err(|error| {
                format!(
                    "Failed to read {}: {}",
                    source_path.to_string_lossy(),
                    error
                )
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let entry_name = entry.file_name().to_string_lossy().to_string();
            let child_zip_path = join_zip_path(&normalized_zip_path, &entry_name);
            add_path_to_zip(zip, &entry.path(), &child_zip_path, file_count, total_bytes)?;
        }
        return Ok(());
    }

    if !file_metadata.is_file() {
        return Ok(());
    }

    zip.start_file(&normalized_zip_path, file_options)
        .map_err(|error| error.to_string())?;
    let mut input = fs::File::open(source_path).map_err(|error| {
        format!(
            "Failed to read {}: {}",
            source_path.to_string_lossy(),
            error
        )
    })?;
    let copied = std::io::copy(&mut input, zip).map_err(|error| {
        format!(
            "Failed to archive {}: {}",
            source_path.to_string_lossy(),
            error
        )
    })?;
    *file_count += 1;
    *total_bytes += copied;
    Ok(())
}

fn documents_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = app.path().document_dir() {
        return Ok(path);
    }

    let app_data = app_data_dir(app)?;
    let Some(container_root) = app_data
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
    else {
        return Err("Failed to resolve the app Documents directory.".to_string());
    };
    Ok(container_root.join("Documents"))
}

fn copy_path_with_stats(
    from: &Path,
    to: &Path,
    file_count: &mut usize,
    total_bytes: &mut u64,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(from).map_err(|err| err.to_string())?;
    if metadata.file_type().is_symlink() {
        return Ok(());
    }

    if metadata.is_dir() {
        fs::create_dir_all(to).map_err(|err| err.to_string())?;
        let mut entries = fs::read_dir(from)
            .map_err(|err| err.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let target = to.join(entry.file_name());
            copy_path_with_stats(&entry.path(), &target, file_count, total_bytes)?;
        }
        return Ok(());
    }

    if !metadata.is_file() {
        return Ok(());
    }

    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::copy(from, to).map_err(|err| err.to_string())?;
    *file_count += 1;
    *total_bytes += metadata.len();
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

fn profile_name_from_id(id: &str) -> String {
    let words = id
        .split(|ch: char| ch == '-' || ch == '_' || ch.is_whitespace())
        .filter_map(|segment| {
            let trimmed = segment.trim();
            if trimmed.is_empty() {
                return None;
            }
            let mut chars = trimmed.chars();
            let first = chars.next()?;
            let mut title = String::new();
            title.push(first.to_ascii_uppercase());
            title.extend(chars);
            Some(title)
        })
        .collect::<Vec<_>>();
    if words.is_empty() {
        "Profile".to_string()
    } else {
        words.join(" ")
    }
}

fn push_normalized_profile(
    app: &tauri::AppHandle,
    mut profile: NotesProfileEntry,
    seen_ids: &mut HashSet<String>,
    seen_roots: &mut HashSet<String>,
    profiles: &mut Vec<NotesProfileEntry>,
) -> Result<(), String> {
    let id = profile.id.trim().to_string();
    if id.is_empty() || !seen_ids.insert(id.clone()) {
        return Ok(());
    }

    profile.id = id.clone();
    profile.name = normalize_profile_name(&profile.name);
    profile.description = normalize_profile_description(&profile.description);
    if profile.notes_root.trim().is_empty() {
        profile.notes_root = profile_root_for_id(app, &id)?.to_string_lossy().to_string();
    }

    let root = PathBuf::from(profile.notes_root.trim());
    if !root.exists() {
        fs::create_dir_all(&root).map_err(|err| err.to_string())?;
    }
    ensure_system_folders(&root)?;

    let normalized_root = root.to_string_lossy().to_string();
    if !seen_roots.insert(normalized_root.clone()) {
        return Ok(());
    }

    profile.notes_root = normalized_root;
    profiles.push(profile);
    Ok(())
}

fn discover_filesystem_profiles(
    app: &tauri::AppHandle,
    seen_ids: &HashSet<String>,
    seen_roots: &HashSet<String>,
) -> Result<Vec<NotesProfileEntry>, String> {
    let profiles_root = app_data_dir(app)?.join("profiles");
    if !profiles_root.exists() {
        return Ok(Vec::new());
    }

    let mut entries = fs::read_dir(&profiles_root)
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    entries.sort_by_key(|entry| entry.file_name());

    let mut discovered = Vec::new();
    for entry in entries {
        let metadata = entry.metadata().map_err(|err| err.to_string())?;
        if !metadata.is_dir() {
            continue;
        }

        let id = entry.file_name().to_string_lossy().trim().to_string();
        if id.is_empty() || seen_ids.contains(&id) {
            continue;
        }

        let notes_root = entry.path().join("notes");
        if !notes_root.is_dir() {
            continue;
        }

        let notes_root_string = notes_root.to_string_lossy().to_string();
        if seen_roots.contains(&notes_root_string) {
            continue;
        }

        discovered.push(NotesProfileEntry {
            id: id.clone(),
            name: profile_name_from_id(&id),
            description: String::new(),
            notes_root: notes_root_string,
        });
    }

    Ok(discovered)
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

/// Persist profiles state to disk as pretty-printed JSON.
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
    let mut seen_ids = HashSet::new();
    let mut seen_roots = HashSet::new();
    let mut profiles = Vec::new();
    for profile in state.profiles.drain(..) {
        push_normalized_profile(app, profile, &mut seen_ids, &mut seen_roots, &mut profiles)?;
    }

    if profiles.is_empty() {
        for profile in default_profiles_state(app)?.profiles {
            push_normalized_profile(app, profile, &mut seen_ids, &mut seen_roots, &mut profiles)?;
        }
    }

    let discovered = discover_filesystem_profiles(app, &seen_ids, &seen_roots)?;
    for profile in discovered {
        push_normalized_profile(app, profile, &mut seen_ids, &mut seen_roots, &mut profiles)?;
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
pub(crate) fn ensure_profiles_state(app: &tauri::AppHandle) -> Result<NotesProfilesFile, String> {
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
                let state = normalize_profiles_state(app, default_profiles_state(app)?)?;
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

    let state = normalize_profiles_state(app, default_profiles_state(app)?)?;
    write_profiles_state(app, &state)?;
    Ok(state)
}

/// Convert internal profiles state to the frontend-facing snapshot.
pub(crate) fn profiles_snapshot(state: &NotesProfilesFile) -> NotesProfilesSnapshot {
    NotesProfilesSnapshot {
        active_profile_id: state.active_profile_id.clone(),
        profiles: state.profiles.clone(),
    }
}

/// Look up a profile by its id.
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

/// Switch the active profile and persist the change.
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

/// Create a new profile with an auto-generated id and notes root directory.
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

/// Update a profile's name and/or description.
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

/// Delete a profile (at least one must remain). Switches active if needed.
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

/// Create a zip archive containing all profiles' notes and state.
pub(crate) fn create_profiles_backup_zip_impl(
    app: &tauri::AppHandle,
) -> Result<ProfilesBackupArchive, String> {
    let state = ensure_profiles_state(app)?;
    let export_root = app_data_dir(app)?.join("exports");
    fs::create_dir_all(&export_root).map_err(|error| error.to_string())?;

    let timestamp = now_ms().unwrap_or(0);
    let archive_name = format!("type-backup-{}.zip", timestamp);
    let archive_path = export_root.join(&archive_name);
    if archive_path.exists() {
        fs::remove_file(&archive_path).map_err(|error| error.to_string())?;
    }

    let output = fs::File::create(&archive_path).map_err(|error| error.to_string())?;
    let mut zip = zip::ZipWriter::new(output);
    let metadata_file_options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    let snapshot_json = serde_json::to_vec_pretty(&state).map_err(|error| error.to_string())?;
    zip.start_file("profiles-state.json", metadata_file_options)
        .map_err(|error| error.to_string())?;
    zip.write_all(&snapshot_json)
        .map_err(|error| error.to_string())?;

    let mut file_count = 1usize;
    let mut total_bytes = snapshot_json.len() as u64;

    for (index, profile) in state.profiles.iter().enumerate() {
        let notes_root = PathBuf::from(profile.notes_root.trim());
        if !notes_root.exists() {
            return Err(format!(
                "Profile \"{}\" notes root does not exist: {}",
                profile.name,
                notes_root.to_string_lossy()
            ));
        }
        let profile_id = sanitize_archive_segment(&profile.id, "profile");
        let zip_prefix = format!("profiles/{:02}-{}/notes", index + 1, profile_id);
        add_path_to_zip(
            &mut zip,
            &notes_root,
            &zip_prefix,
            &mut file_count,
            &mut total_bytes,
        )?;
    }

    zip.finish().map_err(|error| error.to_string())?;

    Ok(ProfilesBackupArchive {
        archive_path: archive_path.to_string_lossy().to_string(),
        archive_name,
        profile_count: state.profiles.len(),
        file_count,
        total_bytes,
    })
}

/// Export all profiles to the system Documents directory as plain files.
pub(crate) fn export_profiles_to_documents_impl(
    app: &tauri::AppHandle,
) -> Result<ProfilesDocumentsExport, String> {
    let state = ensure_profiles_state(app)?;
    let documents_root = documents_dir(app)?.join("Type Export");
    fs::create_dir_all(&documents_root).map_err(|err| err.to_string())?;

    let export_name = format!("type-export-{}", now_ms().unwrap_or(0));
    let export_path = documents_root.join(&export_name);
    fs::create_dir_all(&export_path).map_err(|err| err.to_string())?;

    let mut file_count = 0usize;
    let mut total_bytes = 0u64;

    let profiles_state_path = profiles_file_path(app)?;
    if profiles_state_path.exists() {
        let target = export_path.join(".notes-profiles.json");
        copy_path_with_stats(&profiles_state_path, &target, &mut file_count, &mut total_bytes)?;
    }

    let security_path = app_data_dir(app)?.join(".notes-security.json");
    if security_path.exists() {
        let target = export_path.join(".notes-security.json");
        copy_path_with_stats(&security_path, &target, &mut file_count, &mut total_bytes)?;
    }

    let snapshot_json = serde_json::to_vec_pretty(&state).map_err(|err| err.to_string())?;
    let snapshot_target = export_path.join("profiles-state.json");
    fs::write(&snapshot_target, &snapshot_json).map_err(|err| err.to_string())?;
    file_count += 1;
    total_bytes += snapshot_json.len() as u64;

    for (index, profile) in state.profiles.iter().enumerate() {
        let notes_root = PathBuf::from(profile.notes_root.trim());
        if !notes_root.exists() {
            return Err(format!(
                "Profile \"{}\" notes root does not exist: {}",
                profile.name,
                notes_root.to_string_lossy()
            ));
        }
        let folder_name = format!(
            "{:02}-{}",
            index + 1,
            sanitize_archive_segment(&profile.id, "profile")
        );
        let target_root = export_path.join("profiles").join(folder_name).join("notes");
        copy_path_with_stats(&notes_root, &target_root, &mut file_count, &mut total_bytes)?;
    }

    Ok(ProfilesDocumentsExport {
        export_path: export_path.to_string_lossy().to_string(),
        export_name,
        profile_count: state.profiles.len(),
        file_count,
        total_bytes,
    })
}
