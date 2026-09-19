//! Folder tree construction, system folders, and order files.

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
            if is_storage_folder_path(root, &path) {
                continue;
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

/// True if the root-relative path is a protected system folder.
pub fn is_system_folder_rel_path(rel_path: &str) -> bool {
    PROTECTED_SYSTEM_FOLDERS
        .iter()
        .any(|folder| *folder == rel_path)
}

/// True if the root-relative path is kept out of the rendered folder tree.
pub fn is_tree_hidden_rel_path(rel_path: &str) -> bool {
    TREE_HIDDEN_FOLDERS.iter().any(|folder| *folder == rel_path)
}

/// True if the path is the stream folder (the UI's "Feed").
pub fn is_stream_folder_path(root: &Path, path: &Path) -> bool {
    path == root.join(STREAM_FOLDER)
}

// ── System folders ─────────────────────────────────────────────────────────────

/// True if the path is one of the app-owned folders under `_system`.
pub fn is_system_folder_path(root: &Path, path: &Path) -> bool {
    PROTECTED_SYSTEM_FOLDERS
        .iter()
        .any(|folder| path == root.join(folder))
}

/// True if the path falls inside a binary storage folder.
pub fn is_storage_folder_path(root: &Path, path: &Path) -> bool {
    STORAGE_FOLDERS
        .iter()
        .any(|folder| path.starts_with(root.join(folder)))
}

/// Create the `_system` layout. Idempotent, and the only place that decides
/// which folders a notes root is guaranteed to have.
pub fn ensure_system_folders(root: &Path) -> Result<(), String> {
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
        // Dot-entries are infrastructure, not user content (`.git`, `.type`,
        // `.DS_Store`, …). `collect_markdown_note_files` skips them too.
        if name.starts_with('.') {
            continue;
        }
        let child_rel = if rel_path.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel_path, name)
        };
        if is_tree_hidden_rel_path(&child_rel) {
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
    let note_names = if rel_path == STREAM_FOLDER {
        // Stream folder: newest-first by file name. Every naming mode prefixes a
        // timestamp (UTC slug or UUIDv7), so descending name order approximates
        // creation order without reading any note bodies; the feed UI re-sorts
        // by real front-matter timestamps once previews load.
        let mut stream_notes = notes;
        stream_notes.sort_by(|a, b| b.to_lowercase().cmp(&a.to_lowercase()));
        stream_notes
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

/// Persist the order file to disk (no-op for the stream folder, which sorts by
/// date). Checked on the path tail because callers hand over a directory
/// without a notes root to compare it against.
pub fn write_order_file(dir: &Path, order: &OrderFile) -> Result<(), String> {
    let dir_name = dir.file_name().and_then(|name| name.to_str());
    let parent_name = dir
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str());
    if dir_name == Some(STREAM_FOLDER_NAME) && parent_name == Some(SYSTEM_FOLDER) {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Unique scratch dir — the crate has no tempdir dev-dependency.
    fn scratch_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "type-core-tree-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create scratch dir");
        dir
    }

    #[test]
    fn build_folder_node_skips_dot_entries() {
        let root = scratch_dir("dot-entries");
        fs::create_dir_all(root.join("Work")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::create_dir_all(root.join(".type")).unwrap();
        fs::write(root.join("visible.md"), "body").unwrap();
        fs::write(root.join(".hidden.md"), "body").unwrap();

        let node = build_folder_node(&root, "").expect("build tree");

        let folders: Vec<&str> = node.children.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(folders, vec!["Work"]);
        let notes: Vec<&str> = node.notes.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(notes, vec!["visible.md"]);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn tree_exposes_stream_and_archive_but_hides_the_rest_of_system() {
        let root = scratch_dir("system-layout");
        ensure_system_folders(&root).expect("create system folders");
        fs::create_dir_all(root.join("Work")).unwrap();

        let node = build_folder_node(&root, "").expect("build tree");
        let roots: Vec<&str> = node.children.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(roots, vec![SYSTEM_FOLDER, "Work"]);

        let system = node
            .children
            .iter()
            .find(|child| child.path == SYSTEM_FOLDER)
            .expect("_system in tree");
        let mut visible: Vec<&str> = system.children.iter().map(|f| f.path.as_str()).collect();
        visible.sort_unstable();
        // agent/me and the three storage folders never reach a shell.
        assert_eq!(visible, vec![ARCHIVE_FOLDER, STREAM_FOLDER]);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn stream_folder_never_gets_an_order_file() {
        let root = scratch_dir("stream-order");
        ensure_system_folders(&root).expect("create system folders");

        let stream = root.join(STREAM_FOLDER);
        write_order_file(&stream, &OrderFile::default()).expect("write order");
        assert!(!stream.join(ORDER_FILE).exists());

        // A user folder that merely happens to be called "stream" still keeps one.
        let lookalike = root.join("stream");
        fs::create_dir_all(&lookalike).unwrap();
        write_order_file(&lookalike, &OrderFile::default()).expect("write order");
        assert!(lookalike.join(ORDER_FILE).exists());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn storage_folders_are_excluded_from_note_collection() {
        let root = scratch_dir("storage-collect");
        ensure_system_folders(&root).expect("create system folders");
        fs::write(root.join(STREAM_FOLDER).join("kept.md"), "body").unwrap();
        fs::write(
            root.join(HANDWRITING_STORAGE_FOLDER).join("stray.md"),
            "body",
        )
        .unwrap();
        fs::write(root.join(AGENT_FOLDER).join("thought.md"), "body").unwrap();

        let mut files = Vec::new();
        collect_markdown_note_files(&root, &root, &mut files).expect("collect");
        let mut names: Vec<String> = files
            .iter()
            .map(|path| strip_root(&root, path))
            .collect();
        names.sort();
        // Storage is binary-only; agent notes are real notes and stay collectable.
        assert_eq!(
            names,
            vec!["_system/agent/thought.md", "_system/stream/kept.md"]
        );

        fs::remove_dir_all(&root).ok();
    }
}
