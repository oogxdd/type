//! Folder tree construction, system folders, legacy migration, and order files.

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use super::*;

// ── File collection ────────────────────────────────────────────────────────────

/// Recursively collect all `.md` files, skipping hidden and storage folders.
pub fn collect_markdown_note_files(
    root: &Path,
    dir: &Path,
    files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ORDER_FILE {
            continue;
        }
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if metadata.is_dir() {
            if name.starts_with('.') {
                continue;
            }
            if dir == root {
                if HIDDEN_ROOT_FOLDERS.iter().any(|hidden| *hidden == name) {
                    continue;
                }
            }
            collect_markdown_note_files(root, &path, files)?;
            continue;
        }
        if metadata.is_file() && path.extension().and_then(|value| value.to_str()) == Some("md") {
            files.push(path);
        }
    }
    Ok(())
}

// ── Ordering & sorting ─────────────────────────────────────────────────────────

/// Sort names according to a persisted order list, alphabetical fallback.
pub fn sort_by_order(mut names: Vec<String>, order: &[String]) -> Vec<String> {
    let mut index = HashMap::new();
    for (idx, name) in order.iter().enumerate() {
        index.insert(name, idx);
    }
    names.sort_by(|a, b| {
        let a_idx = index.get(a).copied().unwrap_or(usize::MAX);
        let b_idx = index.get(b).copied().unwrap_or(usize::MAX);
        a_idx
            .cmp(&b_idx)
            .then_with(|| a.to_lowercase().cmp(&b.to_lowercase()))
    });
    names
}

// ── Folder classification ──────────────────────────────────────────────────────

/// True if the folder name matches a protected system folder.
pub fn is_system_folder_name(name: &str) -> bool {
    PROTECTED_SYSTEM_FOLDERS
        .iter()
        .any(|folder| *folder == name)
}

/// True if the folder should be hidden from the tree at root level.
pub fn is_hidden_root_folder_name(name: &str) -> bool {
    HIDDEN_ROOT_FOLDERS.iter().any(|folder| *folder == name)
}

/// True if the path is the Feed folder.
pub fn is_feed_folder_path(root: &Path, path: &Path) -> bool {
    path == root.join(FEED_FOLDER)
}

// ── Legacy migration ───────────────────────────────────────────────────────────

fn migrate_legacy_folder_name(root: &Path, from_name: &str, to_name: &str) -> Result<(), String> {
    let from = root.join(from_name);
    if !from.exists() {
        return Ok(());
    }
    let to = root.join(to_name);
    if !to.exists() {
        fs::rename(&from, &to).map_err(|err| err.to_string())?;
        return Ok(());
    }
    for entry in fs::read_dir(&from).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        if target.exists() {
            continue;
        }
        fs::rename(&source, &target).map_err(|err| err.to_string())?;
    }
    fs::remove_dir_all(&from).map_err(|err| err.to_string())?;
    Ok(())
}

fn migrate_legacy_system_folders(root: &Path) -> Result<(), String> {
    migrate_legacy_folder_name(root, LEGACY_UNSORTED_FOLDER, FEED_FOLDER)?;
    migrate_legacy_folder_name(root, LEGACY_RECORDINGS_FOLDER, RECORDINGS_STORAGE_FOLDER)?;
    let feed_order = root.join(FEED_FOLDER).join(ORDER_FILE);
    if feed_order.exists() {
        let _ = fs::remove_file(feed_order);
    }
    Ok(())
}

// ── System folders ─────────────────────────────────────────────────────────────

/// True if the path is a direct child of root and a system folder.
pub fn is_system_folder_path(root: &Path, path: &Path) -> bool {
    if path.parent() != Some(root) {
        return false;
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(is_system_folder_name)
}

/// Check if a path falls inside a storage folder (recordings/attachments).
pub fn is_storage_folder_path(root: &Path, path: &Path) -> bool {
    path.starts_with(root.join(RECORDINGS_STORAGE_FOLDER))
        || path.starts_with(root.join(LEGACY_RECORDINGS_FOLDER))
        || path.starts_with(root.join(ATTACHMENTS_STORAGE_FOLDER))
}

/// Create required system folders and ensure visible ones appear in the order file.
pub fn ensure_system_folders(root: &Path) -> Result<(), String> {
    migrate_legacy_system_folders(root)?;

    for folder in REQUIRED_SYSTEM_FOLDERS {
        let path = root.join(folder);
        if path.exists() {
            continue;
        }
        fs::create_dir_all(&path).map_err(|err| {
            format!(
                "Failed to create system folder {}: {}",
                path.to_string_lossy(),
                err
            )
        })?;
    }

    let mut order = read_order_file(root);
    let mut changed = false;
    for folder in VISIBLE_SYSTEM_FOLDERS {
        if !order.folder_order.iter().any(|name| name == folder) {
            order.folder_order.push(folder.to_string());
            changed = true;
        }
    }

    if changed {
        write_order_file(root, &order)?;
    }

    Ok(())
}

// ── Folder tree ────────────────────────────────────────────────────────────────

/// Recursively build the folder/note tree for the frontend sidebar.
pub fn build_folder_node(dir: &Path, rel_path: &str) -> Result<FolderNode, String> {
    let order = read_order_file(dir);
    let mut folders = Vec::new();
    let mut notes = Vec::new();

    for entry in fs::read_dir(dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ORDER_FILE {
            continue;
        }
        if rel_path.is_empty() && is_hidden_root_folder_name(&name) {
            continue;
        }
        let meta = entry.metadata().map_err(|err| err.to_string())?;
        if meta.is_dir() {
            folders.push(name);
        } else if meta.is_file() {
            if path.extension().and_then(|ext| ext.to_str()) == Some("md") {
                notes.push(name);
            }
        }
    }

    let folder_names = sort_by_order(folders, &order.folder_order);
    let note_names = if rel_path == FEED_FOLDER {
        // Feed folder: newest-first by file name. Every naming mode prefixes a
        // timestamp (UTC slug or UUIDv7), so descending name order approximates
        // creation order without reading any note bodies; the feed UI re-sorts
        // by real front-matter timestamps once previews load.
        let mut feed_notes = notes;
        feed_notes.sort_by(|a, b| b.to_lowercase().cmp(&a.to_lowercase()));
        feed_notes
    } else {
        sort_by_order(notes, &order.note_order)
    };

    let mut children = Vec::new();
    for name in folder_names {
        let child_path = dir.join(&name);
        let child_rel = if rel_path.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel_path, name)
        };
        children.push(build_folder_node(&child_path, &child_rel)?);
    }

    let mut note_entries = Vec::new();
    for name in note_names {
        let note_rel = if rel_path.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel_path, name)
        };
        note_entries.push(NoteEntry {
            name,
            path: note_rel,
        });
    }

    Ok(FolderNode {
        name: if rel_path.is_empty() {
            "Notes".to_string()
        } else {
            dir.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Folder")
                .to_string()
        },
        path: rel_path.to_string(),
        children,
        notes: note_entries,
    })
}

// ── Order file I/O ─────────────────────────────────────────────────────────────

/// Read the `.notes-order.json` from a directory, returning defaults if missing.
pub fn read_order_file(dir: &Path) -> OrderFile {
    let file_path = dir.join(ORDER_FILE);
    if let Ok(contents) = fs::read_to_string(file_path) {
        if let Ok(order) = serde_json::from_str::<OrderFile>(&contents) {
            return order;
        }
    }
    OrderFile::default()
}

/// Persist the order file to disk (no-op for Feed folder, which sorts by date).
pub fn write_order_file(dir: &Path, order: &OrderFile) -> Result<(), String> {
    if dir
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == FEED_FOLDER)
    {
        return Ok(());
    }
    let file_path = dir.join(ORDER_FILE);
    let contents = serde_json::to_string_pretty(order).map_err(|err| err.to_string())?;
    fs::write(file_path, contents).map_err(|err| err.to_string())
}

/// Remove entries from the folder or note order list.
pub fn update_order_remove(
    dir: &Path,
    names: &[String],
    is_folder: bool,
) -> Result<(), String> {
    let mut order = read_order_file(dir);
    if is_folder {
        order.folder_order.retain(|name| !names.contains(name));
    } else {
        order.note_order.retain(|name| !names.contains(name));
    }
    write_order_file(dir, &order)
}

/// Append entries to the folder or note order list if not already present.
pub fn update_order_append(
    dir: &Path,
    names: &[String],
    is_folder: bool,
) -> Result<(), String> {
    let mut order = read_order_file(dir);
    let list = if is_folder {
        &mut order.folder_order
    } else {
        &mut order.note_order
    };
    for name in names {
        if !list.contains(name) {
            list.push(name.clone());
        }
    }
    write_order_file(dir, &order)
}

/// Rename an entry in the order list (preserving its position).
pub fn update_order_rename(
    dir: &Path,
    old_name: &str,
    new_name: &str,
    is_folder: bool,
) -> Result<(), String> {
    let mut order = read_order_file(dir);
    let list = if is_folder {
        &mut order.folder_order
    } else {
        &mut order.note_order
    };
    if let Some(pos) = list.iter().position(|item| item == old_name) {
        list[pos] = new_name.to_string();
    }
    write_order_file(dir, &order)
}
