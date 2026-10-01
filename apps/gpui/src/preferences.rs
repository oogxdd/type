use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use type_core::AppEnv;

#[derive(Serialize, Deserialize)]
#[serde(default)]
pub struct Preferences {
    pub dark: bool,
    pub vim: bool,
    pub font_size: f32,
    pub sidebar: bool,
    pub rail: bool,
    pub line_numbers: bool,
    pub heading_folding: bool,
    pub current_line_highlight: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            dark: true,
            vim: true,
            font_size: 17.,
            sidebar: true,
            rail: true,
            line_numbers: true,
            heading_folding: true,
            current_line_highlight: true,
        }
    }
}
impl Preferences {
    pub fn load(env: &AppEnv) -> Self {
        let mut prefs: Self = std::fs::read(env.app_data_dir.join("gpui-appearance.json"))
            .ok()
            .and_then(|s| serde_json::from_slice(&s).ok())
            .unwrap_or_default();
        prefs.font_size = prefs.font_size.clamp(10., 40.);
        prefs
    }
    pub fn save(&self, env: &AppEnv) -> Result<(), String> {
        std::fs::create_dir_all(&env.app_data_dir).map_err(|e| e.to_string())?;
        let path = env.app_data_dir.join("gpui-appearance.json");
        let tmp = path.with_extension("json.tmp");
        std::fs::write(
            &tmp,
            serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        std::fs::rename(tmp, path).map_err(|e| e.to_string())
    }
}

/// Debug launches always have a separate identity. The explicit argument also
/// makes smoke tests reproducible and never points them at the user's notes.
pub fn environment(args: &[String], data_home: &Path) -> Result<AppEnv, String> {
    let mut data_dir = None;
    let mut production = !cfg!(debug_assertions);
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--data-dir" => {
                i += 1;
                let value = args.get(i).ok_or("--data-dir requires an absolute path.")?;
                let path = PathBuf::from(value);
                if !path.is_absolute() {
                    return Err("--data-dir requires an absolute path.".into());
                }
                data_dir = Some(path);
            }
            "--dev" => production = false,
            "--production" => production = true,
            arg => return Err(format!("Unknown argument: {arg}")),
        }
        i += 1;
    }
    let id = if production {
        "com.digital.type2"
    } else {
        "com.digital.type2.gpui.dev"
    };
    let mut env = AppEnv::new(data_dir.unwrap_or_else(|| data_home.join(id)));
    env.documents_dir = dirs::document_dir();
    Ok(env)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_preferences_keep_values_and_enable_new_editor_options() {
        let prefs: Preferences = serde_json::from_str(
            r#"{"dark":false,"vim":false,"font_size":22,"sidebar":false,"rail":false}"#,
        )
        .unwrap();
        assert!(!prefs.dark && !prefs.vim && !prefs.sidebar && !prefs.rail);
        assert_eq!(prefs.font_size, 22.);
        assert!(prefs.line_numbers && prefs.heading_folding && prefs.current_line_highlight);
    }
    #[test]
    fn development_identity_and_explicit_paths_are_isolated() {
        assert!(
            environment(&["--dev".into()], Path::new("/tmp/data"))
                .unwrap()
                .app_data_dir
                .ends_with("com.digital.type2.gpui.dev")
        );
        assert_eq!(
            environment(
                &["--data-dir".into(), "/tmp/fixture".into()],
                Path::new("/tmp/data")
            )
            .unwrap()
            .app_data_dir,
            PathBuf::from("/tmp/fixture")
        );
        assert!(environment(&["--data-dir".into(), "relative".into()], Path::new("/tmp")).is_err());
    }
}
