//! View models derived from the core's `FolderNode` tree.
//!
//! The core hands back a recursive tree that already hides dot-entries and the
//! `Recordings` storage folder. All we add here is presentation state: which
//! folders are expanded, and how a note's preview text and badges are derived.

use std::collections::HashSet;

use type_core::{FolderNode, NotePreviewEntry};

/// One visible row in the folder pane.
pub struct FolderRow {
    pub path: String,
    pub name: String,
    /// Nesting level, used only for the indent prefix.
    pub depth: usize,
    pub expanded: bool,
    /// Drives the ▸ / ▾ marker; leaf folders get neither.
    pub has_children: bool,
}

/// Flatten the tree into the rows the folder pane draws, honouring collapse
/// state: a collapsed folder contributes its own row but none of its children.
///
/// The root node itself is not rendered — its children (`Feed`, `Archieve`, and
/// the user's folders) are the top level.
pub fn flatten_folders(root: &FolderNode, expanded: &HashSet<String>) -> Vec<FolderRow> {
    let mut rows = Vec::new();
    for child in &root.children {
        push_folder_rows(child, expanded, 0, &mut rows);
    }
    rows
}

fn push_folder_rows(
    node: &FolderNode,
    expanded: &HashSet<String>,
    depth: usize,
    rows: &mut Vec<FolderRow>,
) {
    let is_expanded = expanded.contains(&node.path);
    rows.push(FolderRow {
        path: node.path.clone(),
        name: node.name.clone(),
        depth,
        expanded: is_expanded,
        has_children: !node.children.is_empty(),
    });
    if is_expanded {
        for child in &node.children {
            push_folder_rows(child, expanded, depth + 1, rows);
        }
    }
}

/// Depth-first lookup of a folder by its root-relative path.
pub fn find_folder<'a>(root: &'a FolderNode, path: &str) -> Option<&'a FolderNode> {
    if root.path == path {
        return Some(root);
    }
    root.children
        .iter()
        .find_map(|child| find_folder(child, path))
}

/// Every folder path in the tree, used by `:mv` completion.
pub fn collect_folder_paths(root: &FolderNode, out: &mut Vec<String>) {
    for child in &root.children {
        out.push(child.path.clone());
        collect_folder_paths(child, out);
    }
}

/// One row in the note list.
pub struct NoteRow {
    pub path: String,
    /// First meaningful line of the body, falling back to the file name.
    pub title: String,
    /// True when the note was created from an audio recording. This comes free
    /// from front matter (`recording_audio_path`) — no recordings code needed,
    /// which is why the TUI can skip the whole `recordings` feature.
    pub is_audio: bool,
    /// Front-matter timestamp used for sorting; the core's tree is name-sorted.
    pub sort_ms: Option<i64>,
}

/// Build note rows from a bulk preview fetch.
///
/// `previews` may be shorter than the folder's note list: `list_note_previews`
/// silently skips notes that vanished or failed to decrypt, so a single broken
/// file cannot blank out the pane.
pub fn note_rows(previews: Vec<NotePreviewEntry>) -> Vec<NoteRow> {
    let mut rows: Vec<NoteRow> = previews
        .into_iter()
        .map(|entry| NoteRow {
            title: preview_title(&entry.content, &entry.path),
            is_audio: entry.meta.recording_audio_path.is_some(),
            sort_ms: entry.meta.updated_ms.or(entry.meta.created_ms),
            path: entry.path,
        })
        .collect();
    // Newest first. Notes without any timestamp sink to the bottom rather than
    // jumping to the top, which is what `None` would do under a naive sort.
    rows.sort_by(|a, b| b.sort_ms.unwrap_or(i64::MIN).cmp(&a.sort_ms.unwrap_or(i64::MIN)));
    rows
}

/// Derive a one-line title: first non-blank line, with markdown heading and
/// list markers stripped. Falls back to the file name for empty notes.
fn preview_title(content: &str, path: &str) -> String {
    let line = content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");

    let cleaned = line
        .trim_start_matches('#')
        .trim_start_matches(['>', '-', '*', '+'])
        .trim();

    if cleaned.is_empty() {
        file_stem(path).to_string()
    } else {
        cleaned.chars().take(120).collect()
    }
}

/// File name without directories or the `.md` extension.
pub fn file_stem(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(".md").unwrap_or(name)
}
