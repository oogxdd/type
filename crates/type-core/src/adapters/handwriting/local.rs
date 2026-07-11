//! Desktop-local EasyOCR provider running in the app-managed Python env.

use crate::{
    ensure_local_ocr_env, local_ocr_env_ready, local_ocr_managed_python, local_ocr_model_ready,
    mark_local_ocr_model_ready, AppEnv,
};
use serde::Deserialize;
use std::{
    fs,
    path::Path,
    process::{Command, Stdio},
};

use super::LocalOcrStatusResult;

const OCR_CHECK_SCRIPT: &str = include_str!("local_scripts/check.py");
const OCR_TRANSCRIBE_SCRIPT: &str = include_str!("local_scripts/transcribe.py");

#[derive(Deserialize)]
struct LocalOcrScriptOutput {
    available: Option<bool>,
    text: Option<String>,
    error: Option<String>,
}

fn run_script(
    python: &Path,
    script_name: &str,
    script: &str,
    args: &[&Path],
) -> Result<LocalOcrScriptOutput, String> {
    let script_path = std::env::temp_dir().join(script_name);
    fs::write(&script_path, script).map_err(|error| error.to_string())?;
    let output = Command::new(python)
        .arg(&script_path)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Local OCR failed to start: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Local OCR failed: {}", stderr.trim()));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Local OCR returned invalid output: {error}"))
}

pub fn check_local_ocr_availability(
    app: &AppEnv,
    model_path: &Path,
    setup: bool,
) -> LocalOcrStatusResult {
    if !setup {
        return LocalOcrStatusResult {
            available: local_ocr_env_ready(app) && local_ocr_model_ready(model_path),
            python_found: local_ocr_managed_python(app)
                .map(|path| path.exists())
                .unwrap_or(false),
            model_path: model_path.to_string_lossy().into_owned(),
            error: None,
        };
    }

    let result = ensure_local_ocr_env(app).and_then(|python| {
        fs::create_dir_all(model_path).map_err(|error| error.to_string())?;
        let output = run_script(
            &python,
            "type-easyocr-check.py",
            OCR_CHECK_SCRIPT,
            &[model_path],
        )?;
        if output.available == Some(true) {
            mark_local_ocr_model_ready(model_path)?;
            Ok(())
        } else {
            Err(output
                .error
                .unwrap_or_else(|| "EasyOCR setup failed.".to_string()))
        }
    });
    LocalOcrStatusResult {
        available: result.is_ok(),
        python_found: local_ocr_managed_python(app)
            .map(|path| path.exists())
            .unwrap_or(false),
        model_path: model_path.to_string_lossy().into_owned(),
        error: result.err(),
    }
}

pub fn transcribe_handwriting_locally(
    app: &AppEnv,
    image_path: &Path,
    model_path: &Path,
) -> Result<String, String> {
    let python = ensure_local_ocr_env(app)?;
    fs::create_dir_all(model_path).map_err(|error| error.to_string())?;
    let output = run_script(
        &python,
        "type-easyocr-transcribe.py",
        OCR_TRANSCRIBE_SCRIPT,
        &[image_path, model_path],
    )?;
    let text = output.text.unwrap_or_default().trim().to_string();
    if text.is_empty() {
        return Err(output
            .error
            .unwrap_or_else(|| "Local OCR did not return text.".to_string()));
    }
    mark_local_ocr_model_ready(model_path)?;
    Ok(text)
}
