//! Managed Python environment for desktop-local handwriting OCR.

use crate::{app_data_dir, AppEnv};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};

const READY_MARKER: &str = ".ready";
static ENV_SETUP_LOCK: Mutex<()> = Mutex::new(());

fn managed_root(app: &AppEnv) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("ocr"))
}

fn venv_dir(app: &AppEnv) -> Result<PathBuf, String> {
    Ok(managed_root(app)?.join("env"))
}

fn ready_marker(app: &AppEnv) -> Result<PathBuf, String> {
    Ok(managed_root(app)?.join(READY_MARKER))
}

pub fn local_ocr_managed_python(app: &AppEnv) -> Result<PathBuf, String> {
    let dir = venv_dir(app)?;
    #[cfg(windows)]
    {
        Ok(dir.join("Scripts").join("python.exe"))
    }
    #[cfg(not(windows))]
    {
        Ok(dir.join("bin").join("python3"))
    }
}

pub fn local_ocr_env_ready(app: &AppEnv) -> bool {
    local_ocr_managed_python(app)
        .map(|python| python.exists())
        .unwrap_or(false)
        && ready_marker(app)
            .map(|marker| marker.exists())
            .unwrap_or(false)
}

/// Provision a pinned Python environment with EasyOCR and its native wheels.
pub fn ensure_local_ocr_env(app: &AppEnv) -> Result<PathBuf, String> {
    let _guard = ENV_SETUP_LOCK
        .lock()
        .map_err(|_| "local OCR env setup lock poisoned".to_string())?;
    let python = local_ocr_managed_python(app)?;
    let marker = ready_marker(app)?;
    if python.exists() && marker.exists() {
        return Ok(python);
    }

    let uv = crate::adapters::whisper_env::ensure_uv(app)?;
    if !python.exists() {
        let venv = venv_dir(app)?;
        if let Some(parent) = venv.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        crate::adapters::whisper_env::run(
            "Creating OCR Python environment",
            Command::new(&uv)
                .arg("venv")
                .arg("--python")
                .arg(crate::adapters::whisper_env::MANAGED_PYTHON_VERSION)
                .arg(&venv),
        )?;
    }

    crate::adapters::whisper_env::run(
        "Installing EasyOCR",
        Command::new(&uv)
            .arg("pip")
            .arg("install")
            .arg("--python")
            .arg(&python)
            .arg("easyocr"),
    )?;
    fs::write(
        &marker,
        crate::adapters::whisper_env::MANAGED_PYTHON_VERSION,
    )
    .map_err(|error| error.to_string())?;
    Ok(python)
}

/// Resolve the configured model directory. Empty uses app data; a configured
/// path must be absolute so external-volume behavior is deterministic.
pub fn resolve_local_ocr_model_path(app: &AppEnv, configured: &str) -> Result<PathBuf, String> {
    let trimmed = configured.trim();
    let path = if trimmed.is_empty() {
        managed_root(app)?.join("models")
    } else {
        PathBuf::from(trimmed)
    };
    if !path.is_absolute() {
        return Err("Local OCR model storage path must be absolute.".to_string());
    }
    Ok(path)
}

pub fn local_ocr_model_ready(model_path: &Path) -> bool {
    model_path.join(".easyocr-ready").exists()
}

pub fn mark_local_ocr_model_ready(model_path: &Path) -> Result<(), String> {
    fs::create_dir_all(model_path).map_err(|error| error.to_string())?;
    fs::write(model_path.join(".easyocr-ready"), b"easyocr").map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_path_defaults_to_app_data_and_accepts_external_absolute_paths() {
        let app_data = std::env::temp_dir().join("type-ocr-path-test");
        let external = std::env::temp_dir().join("type-ocr-external-models");
        let app = AppEnv::new(&app_data);
        assert_eq!(
            resolve_local_ocr_model_path(&app, "").unwrap(),
            app_data.join("ocr/models")
        );
        assert_eq!(
            resolve_local_ocr_model_path(&app, external.to_string_lossy().as_ref()).unwrap(),
            external
        );
        assert!(resolve_local_ocr_model_path(&app, "relative/models").is_err());
    }
}
