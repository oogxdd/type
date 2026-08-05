use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub use crate::ports::object_sync::ObjectStoreSettings;
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
    pub local_ocr_model_path: String,
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
            local_ocr_model_path: String::new(),
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
    "local".to_string()
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
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub git_trusted_ssh_host: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub git_trusted_ssh_host_key_sha256: String,
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
            git_trusted_ssh_host: String::new(),
            git_trusted_ssh_host_key_sha256: String::new(),
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
/// Device-local git connection settings. `settings.json` syncs with the repo
/// (transcription_mode is meant to be shared), but the git connection —
/// remote URL, credentials, pinned host key — describes how *this device*
/// connects and must not travel between devices. `device.json` is excluded
/// from sync via `.git/info/exclude` (see `ensure_git_repo`).
pub const DEVICE_SETTINGS_FILE: &str = "device.json";
/// The repo-relative path git should exclude from sync.
pub const DEVICE_SETTINGS_EXCLUDE_PATTERN: &str = "/.type/device.json";

/// The device-local settings file: the git connection, plus the object-storage
/// connection. Both describe how *this device* reaches a remote and carry
/// credentials, so neither may travel between devices.
#[derive(Deserialize, Serialize)]
struct DeviceSettingsFile {
    #[serde(default)]
    git_remote_url: String,
    #[serde(default = "default_git_branch")]
    git_branch: String,
    #[serde(default)]
    git_username: String,
    #[serde(default)]
    git_password: String,
    #[serde(default = "default_git_commit_message")]
    git_commit_message: String,
    #[serde(default)]
    git_trusted_ssh_host: String,
    #[serde(default)]
    git_trusted_ssh_host_key_sha256: String,
    /// Bucket endpoint, credentials and prefix. Absent until sync is set up.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    object_sync: Option<ObjectStoreSettings>,
}

impl Default for DeviceSettingsFile {
    fn default() -> Self {
        Self {
            git_remote_url: String::new(),
            git_branch: default_git_branch(),
            git_username: String::new(),
            git_password: String::new(),
            git_commit_message: default_git_commit_message(),
            git_trusted_ssh_host: String::new(),
            git_trusted_ssh_host_key_sha256: String::new(),
            object_sync: None,
        }
    }
}

fn device_settings_path(notes_root: &Path) -> PathBuf {
    notes_root.join(SETTINGS_FOLDER).join(DEVICE_SETTINGS_FILE)
}

fn read_device_settings(notes_root: &Path) -> DeviceSettingsFile {
    fs::read_to_string(device_settings_path(notes_root))
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

fn write_device_settings(
    notes_root: &Path,
    device: &DeviceSettingsFile,
) -> Result<(), String> {
    let folder = notes_root.join(SETTINGS_FOLDER);
    if !folder.exists() {
        fs::create_dir_all(&folder).map_err(|err| {
            format!(
                "Failed to create settings folder '{}': {err}",
                folder.display()
            )
        })?;
    }
    let content = serde_json::to_string_pretty(device).map_err(|err| err.to_string())?;
    let path = device_settings_path(notes_root);
    fs::write(&path, content).map_err(|err| {
        format!(
            "Failed to write device settings '{}': {err}",
            path.display()
        )
    })
}

/// Read this device's object-storage connection for a profile.
pub fn load_object_store_settings(notes_root: &Path) -> ObjectStoreSettings {
    read_device_settings(notes_root)
        .object_sync
        .unwrap_or_default()
}

/// Persist the object-storage connection, leaving the git connection alone.
pub fn save_object_store_settings(
    notes_root: &Path,
    settings: &ObjectStoreSettings,
) -> Result<(), String> {
    let mut device = read_device_settings(notes_root);
    device.object_sync = Some(settings.clone());
    write_device_settings(notes_root, &device)
}

pub fn load_profile_settings(notes_root: &Path) -> ProfileSettings {
    let path = notes_root.join(SETTINGS_FOLDER).join(SETTINGS_FILE);
    let mut settings: ProfileSettings = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_else(ProfileSettings::default)
    } else {
        ProfileSettings::default()
    };
    // The device file wins for git fields once it exists. Until then the
    // legacy values inside settings.json keep working (pre-split installs).
    let device_path = device_settings_path(notes_root);
    if device_path.exists() {
        if let Some(device) = fs::read_to_string(&device_path)
            .ok()
            .and_then(|content| serde_json::from_str::<DeviceSettingsFile>(&content).ok())
        {
            settings.git_remote_url = device.git_remote_url;
            settings.git_branch = device.git_branch;
            settings.git_username = device.git_username;
            settings.git_password = device.git_password;
            settings.git_commit_message = device.git_commit_message;
            settings.git_trusted_ssh_host = device.git_trusted_ssh_host;
            settings.git_trusted_ssh_host_key_sha256 = device.git_trusted_ssh_host_key_sha256;
        }
    }
    settings
}

pub fn save_profile_settings(notes_root: &Path, settings: &ProfileSettings) -> Result<(), String> {
    let folder = notes_root.join(SETTINGS_FOLDER);
    if !folder.exists() {
        fs::create_dir_all(&folder).map_err(|err| {
            format!(
                "Failed to create settings folder '{}': {err}",
                folder.display()
            )
        })?;
    }

    // Git connection → device-local file, preserving the object-storage
    // connection that shares it.
    let device = DeviceSettingsFile {
        git_remote_url: settings.git_remote_url.clone(),
        git_branch: settings.git_branch.clone(),
        git_username: settings.git_username.clone(),
        git_password: settings.git_password.clone(),
        git_commit_message: settings.git_commit_message.clone(),
        git_trusted_ssh_host: settings.git_trusted_ssh_host.clone(),
        git_trusted_ssh_host_key_sha256: settings.git_trusted_ssh_host_key_sha256.clone(),
        object_sync: read_device_settings(notes_root).object_sync,
    };
    write_device_settings(notes_root, &device)?;

    // Everything else → the synced settings.json, with git fields blanked so
    // credentials and per-device remotes stop traveling through the repo.
    let mut shared = settings.clone();
    shared.git_remote_url = String::new();
    shared.git_branch = default_git_branch();
    shared.git_username = String::new();
    shared.git_password = String::new();
    shared.git_commit_message = default_git_commit_message();
    shared.git_trusted_ssh_host = String::new();
    shared.git_trusted_ssh_host_key_sha256 = String::new();
    let path = folder.join(SETTINGS_FILE);
    let content = serde_json::to_string_pretty(&shared).map_err(|err| err.to_string())?;
    fs::write(&path, content).map_err(|err| {
        format!(
            "Failed to write shared profile settings '{}': {err}",
            path.display()
        )
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("type-settings-{tag}-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn git_connection_splits_into_device_file() {
        let root = temp_root("split");

        let settings = ProfileSettings {
            git_remote_url: "ssh://pair-t@192.168.1.5:9418/notes".to_string(),
            git_password: "secret-token".to_string(),
            git_trusted_ssh_host: "192.168.1.5".to_string(),
            git_trusted_ssh_host_key_sha256: "SHA256:abc".to_string(),
            transcription_mode: Some(TranscriptionMode::Desktop),
            ..ProfileSettings::default()
        };
        save_profile_settings(&root, &settings).unwrap();

        // The synced settings.json carries no git connection or secrets…
        let shared = fs::read_to_string(root.join(".type").join("settings.json")).unwrap();
        assert!(!shared.contains("secret-token"));
        assert!(!shared.contains("192.168.1.5"));
        assert!(root.join(".type").join(DEVICE_SETTINGS_FILE).exists());

        // …while the loader still returns the merged per-device view.
        let loaded = load_profile_settings(&root);
        assert_eq!(loaded.git_remote_url, settings.git_remote_url);
        assert_eq!(loaded.git_password, "secret-token");
        assert_eq!(loaded.git_trusted_ssh_host_key_sha256, "SHA256:abc");
        assert!(matches!(
            loaded.transcription_mode,
            Some(TranscriptionMode::Desktop)
        ));

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn legacy_settings_without_device_file_keep_git_fields() {
        let root = temp_root("legacy");
        fs::create_dir_all(root.join(".type")).unwrap();
        fs::write(
            root.join(".type").join("settings.json"),
            r#"{"git_remote_url":"https://example.com/notes.git","git_password":"tok"}"#,
        )
        .unwrap();

        let loaded = load_profile_settings(&root);
        assert_eq!(loaded.git_remote_url, "https://example.com/notes.git");
        assert_eq!(loaded.git_password, "tok");

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn object_store_credentials_stay_device_local_and_survive_git_writes() {
        let root = temp_root("object-store");

        let bucket = ObjectStoreSettings {
            endpoint: "https://acct.r2.cloudflarestorage.com".to_string(),
            bucket: "notes".to_string(),
            prefix: "type-notes/p1".to_string(),
            region: "auto".to_string(),
            access_key_id: "AKID".to_string(),
            secret_access_key: "BUCKET-SECRET".to_string(),
            device_id: "dev-1".to_string(),
            enabled: true,
            ..ObjectStoreSettings::default()
        };
        save_object_store_settings(&root, &bucket).unwrap();

        // Writing the git connection must not drop the bucket connection —
        // they share one file and are saved through different call paths.
        save_profile_settings(
            &root,
            &ProfileSettings {
                git_remote_url: "ssh://host/notes".to_string(),
                ..ProfileSettings::default()
            },
        )
        .unwrap();

        let loaded = load_object_store_settings(&root);
        assert_eq!(loaded, bucket);
        assert_eq!(load_profile_settings(&root).git_remote_url, "ssh://host/notes");

        // …and nothing about the bucket leaks into the synced settings file.
        let shared = fs::read_to_string(root.join(".type").join("settings.json")).unwrap();
        assert!(!shared.contains("BUCKET-SECRET"));
        assert!(!shared.contains("r2.cloudflarestorage.com"));

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn an_unconfigured_profile_reports_no_object_store() {
        let root = temp_root("object-store-empty");
        let loaded = load_object_store_settings(&root);
        assert!(!loaded.is_configured());
        assert!(!loaded.is_active());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn local_ocr_is_the_default_and_its_model_path_is_device_local() {
        let root = temp_root("local-ocr-default");
        let config = AppConfig::default();
        assert_eq!(config.handwriting_ocr_provider, "local");
        assert!(config.local_ocr_model_path.is_empty());

        save_app_config(&root, &config).unwrap();
        let loaded = load_app_config(&root);
        assert_eq!(loaded.handwriting_ocr_provider, "local");
        assert!(loaded.local_ocr_model_path.is_empty());

        fs::remove_dir_all(&root).unwrap();
    }
}
