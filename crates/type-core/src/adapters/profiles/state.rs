//! Profile state lifecycle: filesystem discovery, normalization, persistence,
//! legacy migration, and the create/update/delete/set-active/set-root CRUD ops.

use crate::AppEnv;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use crate::{app_data_dir, ensure_system_folders};

use super::*;

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
pub fn legacy_notes_root(app: &AppEnv) -> Result<PathBuf, String> {
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
    app: &AppEnv,
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
        fs::create_dir_all(&root)
            .map_err(|err| format!("Failed to create notes root '{}': {err}", root.display()))?;
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
    app: &AppEnv,
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
pub fn default_profiles_state(app: &AppEnv) -> Result<NotesProfilesFile, String> {
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
pub fn write_profiles_state(
    app: &AppEnv,
    state: &NotesProfilesFile,
) -> Result<(), String> {
    let path = profiles_file_path(app)?;
    let content = serde_json::to_string_pretty(state).map_err(|err| err.to_string())?;
    fs::write(path, content).map_err(|err| err.to_string())
}

/// Validate and normalize a profiles state: remove duplicates, fix empty roots.
pub fn normalize_profiles_state(
    app: &AppEnv,
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
pub fn ensure_profiles_state(app: &AppEnv) -> Result<NotesProfilesFile, String> {
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

/// Look up a profile by its id.
pub fn find_profile<'a>(
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
pub fn set_active_profile_state(
    app: &AppEnv,
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
pub fn create_profile_state(
    app: &AppEnv,
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
pub fn update_profile_state(
    app: &AppEnv,
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
pub fn delete_profile_state(
    app: &AppEnv,
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
pub fn normalize_notes_root_path(notes_root: &str) -> Result<PathBuf, String> {
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
pub fn set_profile_notes_root_state(
    app: &AppEnv,
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
