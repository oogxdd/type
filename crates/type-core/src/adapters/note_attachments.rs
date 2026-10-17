//! Images embedded in note bodies.
//!
//! Bytes live in `_system/_attachments`; the note references them with a
//! standard Markdown image whose target is notes-root relative and starts with
//! `/`, e.g. `![](/_system/_attachments/20261018-153012-a1b2c3.png)`, so the
//! link survives moving the note between folders. Like handwriting images and
//! recordings, attachment bytes are not covered by note-body encryption.

use std::{
    fs::{self, OpenOptions},
    io::Write as _,
    path::{Component, Path, PathBuf},
};

use time::{format_description::FormatItem, macros::format_description, OffsetDateTime};
use uuid::Uuid;

use crate::{normalize_image_extension, ATTACHMENTS_STORAGE_FOLDER};

const FILE_STAMP: &[FormatItem<'static>] =
    format_description!("[year][month][day]-[hour][minute][second]");
/// Refuse accidental huge drops; the editor is not an asset manager.
pub const NOTE_ATTACHMENT_MAX_BYTES: usize = 50 * 1024 * 1024;

/// Copy image bytes into attachment storage and return the Markdown link
/// target (`/_system/_attachments/<name>.<ext>`). Never overwrites a file.
pub fn save_note_attachment(root: &Path, bytes: &[u8], extension: &str) -> Result<String, String> {
    let extension = normalize_image_extension(extension).ok_or_else(|| {
        "Unsupported image type. Supported formats: png, jpg/jpeg, webp, gif.".to_string()
    })?;
    if bytes.is_empty() {
        return Err("The image is empty.".into());
    }
    if bytes.len() > NOTE_ATTACHMENT_MAX_BYTES {
        return Err("Images larger than 50 MB cannot be attached.".into());
    }
    let folder = root.join(ATTACHMENTS_STORAGE_FOLDER);
    fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    let stamp = OffsetDateTime::now_utc()
        .format(FILE_STAMP)
        .map_err(|error| error.to_string())?;
    for _ in 0..16 {
        let random = Uuid::now_v7().simple().to_string();
        let name = format!("{stamp}-{}.{extension}", &random[random.len() - 6..]);
        let path = folder.join(&name);
        let mut file = match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        };
        if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
            let _ = fs::remove_file(&path);
            return Err(error.to_string());
        }
        return Ok(format!("/{ATTACHMENTS_STORAGE_FOLDER}/{name}"));
    }
    Err("Could not allocate an attachment file name.".into())
}

/// Resolve a Markdown image target to a local file inside the notes root.
/// `/x` is root-relative; anything else is relative to the note's folder.
/// URLs, absolute filesystem paths and escapes from the root resolve to `None`.
pub fn resolve_note_attachment(root: &Path, note_path: &str, target: &str) -> Option<PathBuf> {
    let target = target.trim();
    if target.is_empty() || target.contains("://") || target.starts_with("data:") {
        return None;
    }
    let (base, relative) = match target.strip_prefix('/') {
        Some(rest) => (PathBuf::new(), rest),
        None => (
            Path::new(note_path)
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_default(),
            target,
        ),
    };
    let mut resolved = PathBuf::new();
    for component in base.join(relative).components() {
        match component {
            Component::Normal(part) => resolved.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                if !resolved.pop() {
                    return None;
                }
            }
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    (!resolved.as_os_str().is_empty()).then(|| root.join(resolved))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("type-note-attachments-{name}-{}", Uuid::now_v7()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn saves_into_attachment_storage_without_overwriting() {
        let root = temp_root("save");
        let first = save_note_attachment(&root, b"one", "PNG").unwrap();
        let second = save_note_attachment(&root, b"two", "jpeg").unwrap();
        assert!(first.starts_with("/_system/_attachments/") && first.ends_with(".png"));
        assert!(second.ends_with(".jpg"));
        assert_ne!(first, second);
        let path = resolve_note_attachment(&root, "Work/a.md", &first).unwrap();
        assert_eq!(fs::read(path).unwrap(), b"one");
        assert!(save_note_attachment(&root, b"x", "tiff").is_err());
        assert!(save_note_attachment(&root, b"", "png").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolves_relative_and_root_targets_inside_the_root_only() {
        let root = Path::new("/notes");
        assert_eq!(
            resolve_note_attachment(root, "Work/a.md", "/_system/_attachments/x.png"),
            Some(root.join("_system/_attachments/x.png"))
        );
        assert_eq!(
            resolve_note_attachment(root, "Work/a.md", "img/x.png"),
            Some(root.join("Work/img/x.png"))
        );
        assert_eq!(
            resolve_note_attachment(root, "Work/a.md", "../x.png"),
            Some(root.join("x.png"))
        );
        assert_eq!(
            resolve_note_attachment(root, "Work/a.md", "../../x.png"),
            None
        );
        assert_eq!(
            resolve_note_attachment(root, "a.md", "https://e.com/x.png"),
            None
        );
        assert_eq!(resolve_note_attachment(root, "a.md", ""), None);
    }
}
