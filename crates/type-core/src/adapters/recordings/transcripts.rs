//! Independent transcription artifacts. Provider retries never overwrite one
//! another; encrypted-note users never get a plaintext transcript sidecar.
use std::{
    fs,
    path::{Path, PathBuf},
};

pub struct TranscriptJsonPaths {
    pub whisper: PathBuf,
    pub assemblyai: PathBuf,
    pub legacy_whisper: PathBuf,
}

pub fn transcript_json_paths(audio_path: &Path) -> TranscriptJsonPaths {
    let stem = audio_path.file_stem().unwrap_or_default().to_string_lossy();
    let parent = audio_path.parent().unwrap_or(Path::new("."));
    TranscriptJsonPaths {
        whisper: parent.join(format!("{stem}.whisper.transcription.json")),
        assemblyai: parent.join(format!("{stem}.assemblyai.transcription.json")),
        legacy_whisper: parent.join(format!("{stem}.transcription.json")),
    }
}

fn encode_for_storage(
    json: &str,
    encrypt: impl FnOnce(&str) -> Result<String, String>,
) -> Result<String, String> {
    serde_json::from_str::<serde_json::Value>(json)
        .map_err(|e| format!("Invalid transcript JSON: {e}"))?;
    let payload = encrypt(json)?;
    if payload == json {
        return Ok(json.to_string());
    }
    serde_json::to_string_pretty(&serde_json::json!({ "encrypted": true, "body": payload }))
        .map_err(|e| e.to_string())
}

fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let temp = path.with_extension(format!("json.{}.tmp", uuid::Uuid::new_v4()));
    let result = fs::write(&temp, content).and_then(|_| fs::rename(&temp, path));
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|e| format!("Failed to save transcription JSON: {e}"))
}

pub fn save_transcription_json(
    audio_path: &Path,
    provider: &str,
    json: &str,
) -> Result<PathBuf, String> {
    let paths = transcript_json_paths(audio_path);
    let path = match provider {
        "whisper" => &paths.whisper,
        "assemblyai" => &paths.assemblyai,
        _ => return Err("Unknown transcription JSON provider.".into()),
    };
    let content = encode_for_storage(json, crate::encrypt_note_body_for_write)?;
    write_atomic(path, &content)?;
    // Existing consumers and older recordings use this filename for Whisper.
    if provider == "whisper" {
        write_atomic(&paths.legacy_whisper, &content)?;
    }
    Ok(path.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_artifact_wraps_ciphertext_without_plaintext_transcript() {
        let json = r#"{"text":"private synthetic phrase","words":[{"text":"private"}]}"#;
        let encrypted = encode_for_storage(json, |_| Ok("synthetic ciphertext".into())).unwrap();
        assert!(!encrypted.contains("private"));
        let value: serde_json::Value = serde_json::from_str(&encrypted).unwrap();
        assert_eq!(value["encrypted"], true);
        assert_eq!(value["body"], "synthetic ciphertext");
        assert_eq!(
            encode_for_storage(json, |j| Ok(j.to_owned())).unwrap(),
            json
        );
        assert!(encode_for_storage(json, |_| Err("locked".into())).is_err());
    }
}
