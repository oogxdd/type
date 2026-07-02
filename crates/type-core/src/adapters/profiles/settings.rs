use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub use crate::ports::profiles::TranscriptionMode;

/// Global application configuration (shared across all profiles).
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AppConfig {
    #[serde(default)]
    pub assemblyai_api_key: String,
    #[serde(default = "default_whisper_model")]
    pub whisper_model: String,
    #[serde(default = "default_handwriting_provider")]
    pub handwriting_ocr_provider: String,
    #[serde(default)]
    pub openai_api_key: String,
    #[serde(default = "default_openai_model")]
    pub openai_model: String,
    #[serde(default)]
    pub huggingface_api_key: String,
    #[serde(default = "default_huggingface_model")]
    pub huggingface_model: String,
    #[serde(default = "default_note_filename_format")]
    pub note_file_name_format: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            assemblyai_api_key: String::new(),
            whisper_model: default_whisper_model(),
            handwriting_ocr_provider: default_handwriting_provider(),
            openai_api_key: String::new(),
            openai_model: default_openai_model(),
            huggingface_api_key: String::new(),
            huggingface_model: default_huggingface_model(),
            note_file_name_format: default_note_filename_format(),
        }
    }
}

fn default_whisper_model() -> String {
    "large-v3".to_string()
}
fn default_handwriting_provider() -> String {
    "openai".to_string()
}
fn default_openai_model() -> String {
    "gpt-4.1-mini".to_string()
}
fn default_huggingface_model() -> String {
    "microsoft/trocr-base-handwritten".to_string()
}
fn default_note_filename_format() -> String {
    "utc_timestamp_slug".to_string()
}

/// Profile-specific configuration (stored inside the notes root).
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ProfileSettings {
    #[serde(default)]
    pub git_remote_url: String,
    #[serde(default = "default_git_branch")]
    pub git_branch: String,
    #[serde(default)]
    pub git_username: String,
    #[serde(default)]
    pub git_password: String,
    #[serde(default = "default_git_commit_message")]
    pub git_commit_message: String,
    #[serde(default = "default_true")]
    pub mobile_auto_transcription_enabled: bool,
    #[serde(default = "default_true")]
    pub mobile_auto_handwriting_ocr_enabled: bool,
    /// Where recordings from this folder get transcribed. `None` (absent in
    /// older settings files) falls back to the legacy flag above — see
    /// [`ProfileSettings::effective_transcription_mode`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcription_mode: Option<TranscriptionMode>,
}

impl Default for ProfileSettings {
    fn default() -> Self {
        Self {
            git_remote_url: String::new(),
            git_branch: default_git_branch(),
            git_username: String::new(),
            git_password: String::new(),
            git_commit_message: default_git_commit_message(),
            mobile_auto_transcription_enabled: true,
            mobile_auto_handwriting_ocr_enabled: true,
            transcription_mode: None,
        }
    }
}

impl ProfileSettings {
    /// Resolve the transcription mode, mapping legacy settings files (which
    /// only had the mobile auto-transcription toggle) onto the new enum.
    pub fn effective_transcription_mode(&self) -> TranscriptionMode {
        self.transcription_mode
            .unwrap_or(if self.mobile_auto_transcription_enabled {
                TranscriptionMode::AssemblyAi
            } else {
                TranscriptionMode::Desktop
            })
    }
}

fn default_git_branch() -> String {
    "main".to_string()
}
fn default_git_commit_message() -> String {
    "Sync notes".to_string()
}
fn default_true() -> bool {
    true
}

const SETTINGS_FOLDER: &str = ".type";
const SETTINGS_FILE: &str = "settings.json";

pub fn load_profile_settings(notes_root: &Path) -> ProfileSettings {
    let path = notes_root.join(SETTINGS_FOLDER).join(SETTINGS_FILE);
    if !path.exists() {
        return ProfileSettings::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_else(ProfileSettings::default)
}

pub fn save_profile_settings(notes_root: &Path, settings: &ProfileSettings) -> Result<(), String> {
    let folder = notes_root.join(SETTINGS_FOLDER);
    if !folder.exists() {
        fs::create_dir_all(&folder).map_err(|err| err.to_string())?;
    }
    let path = folder.join(SETTINGS_FILE);
    let content = serde_json::to_string_pretty(settings).map_err(|err| err.to_string())?;
    fs::write(path, content).map_err(|err| err.to_string())
}

const APP_CONFIG_FILE: &str = "config.json";

pub fn app_config_path(app_data: &Path) -> PathBuf {
    app_data.join(APP_CONFIG_FILE)
}

pub fn load_app_config(app_data: &Path) -> AppConfig {
    let path = app_config_path(app_data);
    if !path.exists() {
        return AppConfig::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_else(AppConfig::default)
}

pub fn save_app_config(app_data: &Path, config: &AppConfig) -> Result<(), String> {
    let path = app_config_path(app_data);
    let content = serde_json::to_string_pretty(config).map_err(|err| err.to_string())?;
    fs::write(path, content).map_err(|err| err.to_string())
}
