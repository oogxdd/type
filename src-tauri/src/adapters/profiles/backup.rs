//! Profile backup: zip-archive creation and export to the Documents folder.

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use tauri::Manager;
use zip::write::FileOptions;

use crate::{app_data_dir, now_ms};

use super::*;

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
