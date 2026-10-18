//! Pinned folders: shortcuts shells list before the folder tree. They live in
//! the synced `.type/pinned-folders.json`, not in a shell's local preferences,
//! so pins travel with the notes repository. Other keys in the file survive.

use std::{fs, path::Path};

pub const PINNED_FOLDERS_FILE: &str = ".type/pinned-folders.json";

/// Pin order is display order. Missing or malformed files mean no pins.
pub fn load_pinned_folders(notes_root: &Path) -> Vec<String> {
    fs::read_to_string(notes_root.join(PINNED_FOLDERS_FILE))
        .ok()
        .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
        .and_then(|value| value.get("folders").cloned())
        .and_then(|folders| serde_json::from_value::<Vec<String>>(folders).ok())
        .unwrap_or_default()
}

pub fn save_pinned_folders(notes_root: &Path, folders: &[String]) -> Result<(), String> {
    crate::application::workspace::with_workspace_write(notes_root, || {
        let path = notes_root.join(PINNED_FOLDERS_FILE);
        let mut value = fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
            .filter(serde_json::Value::is_object)
            .unwrap_or_else(|| serde_json::json!({}));
        let mut unique: Vec<&String> = Vec::new();
        for folder in folders {
            if !folder.is_empty() && !unique.contains(&folder) {
                unique.push(folder);
            }
        }
        value["folders"] = serde_json::json!(unique);
        let content = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let temp = path.with_extension(format!("json.{}.tmp", uuid::Uuid::new_v4()));
        let result =
            fs::write(&temp, format!("{content}\n")).and_then(|_| fs::rename(&temp, &path));
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result.map_err(|e| format!("Failed to save pinned folders: {e}"))
    })
}

/// Rewrites pins after a folder rename/move, including pinned descendants.
/// Returns the new list when anything changed.
pub fn remap_pinned_folders(pins: &[String], old: &str, new: &str) -> Option<Vec<String>> {
    let next: Vec<String> = pins
        .iter()
        .map(|pin| {
            if pin == old {
                new.to_string()
            } else if let Some(tail) = pin.strip_prefix(&format!("{old}/")) {
                format!("{new}/{tail}")
            } else {
                pin.clone()
            }
        })
        .collect();
    (next != pins).then_some(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pins_round_trip_in_order_and_preserve_other_keys() {
        let root = std::env::temp_dir().join(format!("type-pins-{}", uuid::Uuid::new_v4()));
        assert!(load_pinned_folders(&root).is_empty());
        fs::create_dir_all(&root.join(".type")).unwrap();
        fs::write(
            &root.join(PINNED_FOLDERS_FILE),
            r#"{"folders":["old"],"future":1}"#,
        )
        .unwrap();
        save_pinned_folders(
            &root,
            &["projects/type".into(), "cv".into(), "cv".into(), "".into()],
        )
        .unwrap();
        assert_eq!(load_pinned_folders(&root), ["projects/type", "cv"]);
        let raw = fs::read_to_string(&root.join(PINNED_FOLDERS_FILE)).unwrap();
        assert!(raw.contains("\"future\": 1"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn remap_follows_renamed_folder_and_descendants_only() {
        let pins = vec![
            "projects/type".into(),
            "projects/typewriter".into(),
            "cv".into(),
        ];
        assert_eq!(
            remap_pinned_folders(&pins, "projects", "work").unwrap(),
            ["work/type", "work/typewriter", "cv"]
        );
        assert_eq!(
            remap_pinned_folders(&pins, "projects/type", "projects/type2").unwrap(),
            ["projects/type2", "projects/typewriter", "cv"]
        );
        assert!(remap_pinned_folders(&pins, "other", "x").is_none());
    }
}
