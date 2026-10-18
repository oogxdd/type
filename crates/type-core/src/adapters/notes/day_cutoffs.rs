//! Manual day boundaries: instants where the user's day actually ended. A note
//! created at or before a cutoff, on the cutoff's local calendar date, belongs
//! to the previous day. They live in the synced `.type/day-cutoffs.json` so
//! every device groups Stream the same way. Note files are never touched, and
//! shells resolve local dates themselves. Other keys in the file survive.

use std::{fs, path::Path};

pub const DAY_CUTOFFS_FILE: &str = ".type/day-cutoffs.json";

/// Epoch milliseconds, ascending. Missing or malformed files mean no cutoffs.
pub fn load_day_cutoffs(notes_root: &Path) -> Vec<i64> {
    let mut cutoffs = fs::read_to_string(notes_root.join(DAY_CUTOFFS_FILE))
        .ok()
        .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
        .and_then(|value| value.get("cutoffs_ms").cloned())
        .and_then(|cutoffs| serde_json::from_value::<Vec<i64>>(cutoffs).ok())
        .unwrap_or_default();
    cutoffs.sort_unstable();
    cutoffs.dedup();
    cutoffs
}

pub fn save_day_cutoffs(notes_root: &Path, cutoffs: &[i64]) -> Result<(), String> {
    crate::application::workspace::with_workspace_write(notes_root, || {
        let path = notes_root.join(DAY_CUTOFFS_FILE);
        let mut value = fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
            .filter(serde_json::Value::is_object)
            .unwrap_or_else(|| serde_json::json!({}));
        let mut sorted = cutoffs.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        value["version"] = serde_json::json!(1);
        value["cutoffs_ms"] = serde_json::json!(sorted);
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
        result.map_err(|e| format!("Failed to save day cutoffs: {e}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cutoffs_round_trip_sorted_and_preserve_other_keys() {
        let root = std::env::temp_dir().join(format!("type-cutoffs-{}", uuid::Uuid::new_v4()));
        assert!(load_day_cutoffs(&root).is_empty());
        fs::create_dir_all(root.join(".type")).unwrap();
        fs::write(
            root.join(DAY_CUTOFFS_FILE),
            r#"{"cutoffs_ms":[1],"future":1}"#,
        )
        .unwrap();
        save_day_cutoffs(&root, &[30, 10, 30]).unwrap();
        assert_eq!(load_day_cutoffs(&root), [10, 30]);
        let raw = fs::read_to_string(root.join(DAY_CUTOFFS_FILE)).unwrap();
        assert!(raw.contains("\"future\": 1"));
        assert!(raw.contains("\"version\": 1"));
        fs::write(root.join(DAY_CUTOFFS_FILE), "not json").unwrap();
        assert!(load_day_cutoffs(&root).is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
