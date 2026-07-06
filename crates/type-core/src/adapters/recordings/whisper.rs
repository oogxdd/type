//! Local Whisper transcription via the managed Python subprocess (desktop).

use crate::AppEnv;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;

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
pub fn check_whisper_availability(
    app: &AppEnv,
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
            error: Some(format!(
                "Failed to parse check output: {}. Raw: {}",
                e,
                stdout.trim()
            )),
        },
    }
}

/// One line of progress the embedded script emits per segment as it decodes
/// (it also knows `total_seconds` up front, before any segment is consumed).
#[derive(Deserialize)]
struct WhisperProgressLine {
    processed_seconds: f64,
    total_seconds: f64,
}

/// Transcribe audio using local faster-whisper via the managed Python subprocess.
/// Streams the script's stdout line-by-line as it runs (rather than waiting for
/// the whole process to exit) so `on_progress` can report real-time progress —
/// the script emits one NDJSON line per segment, tagged `"type": "progress"`,
/// and a final `"type": "result"` line once transcription is complete.
/// Returns (plain_text, full_json_string_with_words).
pub fn transcribe_audio_local_whisper(
    audio_path: &Path,
    model: &str,
    python: &Path,
    mut on_progress: impl FnMut(f64, f64),
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

    let mut child = Command::new(python)
        .arg(&script_path)
        .arg(audio_path_str)
        .arg(model)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn whisper process: {}", e))?;

    // Drain stderr on its own thread while we read stdout below — otherwise a
    // chatty stderr (e.g. library warnings) could fill its pipe buffer and
    // deadlock the process against our blocking stdout read.
    let mut stderr_pipe = child.stderr.take().ok_or("Failed to capture stderr")?;
    let stderr_handle = thread::spawn(move || {
        let mut buf = String::new();
        let _ = stderr_pipe.read_to_string(&mut buf);
        buf
    });

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let mut result_line: Option<String> = None;
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { continue };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        match value.get("type").and_then(|v| v.as_str()) {
            Some("progress") => {
                if let Ok(progress) = serde_json::from_value::<WhisperProgressLine>(value) {
                    on_progress(progress.processed_seconds, progress.total_seconds);
                }
            }
            Some("result") => {
                result_line = Some(trimmed.to_string());
            }
            _ => {}
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait for whisper process: {}", e))?;
    let stderr = stderr_handle.join().unwrap_or_default();

    if !status.success() {
        return Err(format!("Whisper transcription failed: {}", stderr.trim()));
    }

    let Some(result_line) = result_line else {
        return Err(format!(
            "Whisper process exited without producing a result. Stderr: {}",
            stderr.trim()
        ));
    };

    let parsed: WhisperScriptOutput = serde_json::from_str(&result_line).map_err(|e| {
        format!(
            "Failed to parse whisper output: {}. Raw: {}",
            e,
            &result_line[..result_line.len().min(500)]
        )
    })?;

    let text = parsed.text.clone();
    // Keep the full JSON (including words) as-is for saving
    let full_json = result_line;

    eprintln!(
        "[recordings] whisper transcription complete: {} chars, language={:?}",
        text.len(),
        parsed.language
    );

    Ok((text, full_json))
}

/// Save word-level transcription JSON alongside the audio file.
/// e.g. audio-xxxx.webm → audio-xxxx.transcription.json
pub fn save_word_level_json(
    audio_path: &Path,
    json_content: &str,
) -> Result<PathBuf, String> {
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
