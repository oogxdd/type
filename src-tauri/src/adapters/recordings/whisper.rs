//! Local Whisper transcription via the managed Python subprocess (desktop).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;

use super::WhisperStatusResult;

/// Python script executed as a subprocess for local whisper transcription.
/// Source lives in `whisper_scripts/transcribe.py` (embedded at compile time).
const WHISPER_TRANSCRIBE_SCRIPT: &str = include_str!("whisper_scripts/transcribe.py");

/// Lightweight check script — just verifies faster_whisper can be imported.
/// If a model is provided as an argument, it also tries to load it (which may trigger download).
/// Source lives in `whisper_scripts/check.py` (embedded at compile time).
const WHISPER_CHECK_SCRIPT: &str = include_str!("whisper_scripts/check.py");

/// JSON output from the local whisper Python script.
#[derive(Deserialize)]
struct WhisperScriptOutput {
    text: String,
    #[allow(dead_code)]
    language: Option<String>,
    #[allow(dead_code)]
    language_probability: Option<f64>,
    #[allow(dead_code)]
    duration: Option<f64>,
    #[allow(dead_code)]
    words: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct WhisperCheckOutput {
    available: bool,
    error: Option<String>,
}

/// Report whether local transcription is ready, optionally provisioning it.
///
/// With `setup == false` this is a cheap, side-effect-free probe (safe to call
/// on UI mount / while polling). With `setup == true` it provisions the managed
/// env and, when a model name is supplied, loads it — triggering a download of
/// the model weights when not already cached.
pub(crate) fn check_whisper_availability(
    app: &tauri::AppHandle,
    model: Option<&str>,
    setup: bool,
) -> WhisperStatusResult {
    if !setup {
        let ready = crate::whisper_env_ready(app);
        return WhisperStatusResult {
            available: ready,
            python_found: ready,
            error: None,
        };
    }

    let python = match crate::ensure_whisper_env(app) {
        Ok(path) => path,
        Err(error) => {
            return WhisperStatusResult {
                available: false,
                python_found: false,
                error: Some(error),
            }
        }
    };

    let mut cmd = Command::new(&python);
    cmd.arg("-c").arg(WHISPER_CHECK_SCRIPT);
    if let Some(m) = model {
        cmd.arg(m);
    }

    let output = match cmd.output() {
        Ok(o) => o,
        Err(e) => {
            return WhisperStatusResult {
                available: false,
                python_found: true,
                error: Some(format!("Failed to run check script: {}", e)),
            }
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return WhisperStatusResult {
            available: false,
            python_found: true,
            error: Some(format!("Check script failed: {}", stderr.trim())),
        };
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    match serde_json::from_str::<WhisperCheckOutput>(&stdout) {
        Ok(result) => WhisperStatusResult {
            available: result.available,
            python_found: true,
            error: result.error,
        },
        Err(e) => WhisperStatusResult {
            available: false,
            python_found: true,
            error: Some(format!("Failed to parse check output: {}. Raw: {}", e, stdout.trim())),
        },
    }
}

/// Transcribe audio using local faster-whisper via the managed Python subprocess.
/// Returns (plain_text, full_json_string_with_words).
pub(crate) fn transcribe_audio_local_whisper(
    audio_path: &Path,
    model: &str,
    python: &Path,
) -> Result<(String, String), String> {
    // Write embedded script to a temp file for reliable execution
    let script_path = std::env::temp_dir().join("type_whisper_transcribe.py");
    fs::write(&script_path, WHISPER_TRANSCRIBE_SCRIPT)
        .map_err(|e| format!("Failed to write whisper script: {}", e))?;

    let audio_path_str = audio_path
        .to_str()
        .ok_or_else(|| "Audio path contains invalid UTF-8".to_string())?;

    eprintln!(
        "[recordings] starting local whisper transcription: model={}, audio={}",
        model, audio_path_str
    );

    let output = Command::new(python)
        .arg(&script_path)
        .arg(audio_path_str)
        .arg(model)
        .output()
        .map_err(|e| format!("Failed to spawn whisper process: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Whisper transcription failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: WhisperScriptOutput = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse whisper output: {}. Raw: {}", e, &stdout[..stdout.len().min(500)]))?;

    let text = parsed.text.clone();
    // Keep the full JSON (including words) as-is for saving
    let full_json = stdout.trim().to_string();

    eprintln!(
        "[recordings] whisper transcription complete: {} chars, language={:?}",
        text.len(),
        parsed.language
    );

    Ok((text, full_json))
}

/// Save word-level transcription JSON alongside the audio file.
/// e.g. audio-xxxx.webm → audio-xxxx.transcription.json
pub(crate) fn save_word_level_json(audio_path: &Path, json_content: &str) -> Result<PathBuf, String> {
    let stem = audio_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("audio");
    let json_path = audio_path
        .parent()
        .unwrap_or(audio_path)
        .join(format!("{}.transcription.json", stem));
    fs::write(&json_path, json_content)
        .map_err(|e| format!("Failed to write transcription JSON: {}", e))?;
    Ok(json_path)
}
