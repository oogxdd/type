//! Audio recording: save, transcription queue (local Whisper + AssemblyAI fallback), listing.

use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
    thread,
    time::Duration,
};
use uuid::Uuid;

use crate::{
    allocate_note_file_name, collect_markdown_note_files, generate_note_id, is_storage_folder_path,
    notes_root, now_ms, parse_note_front_matter, resolve_path, response_error, sanitize_relative,
    strip_root, uuid_tail_without_timestamp_prefix, write_note_with_front_matter,
    NoteFileNameFormat, NoteFrontMatter, FEED_FOLDER, LEGACY_RECORDINGS_FOLDER,
    RECORDINGS_STORAGE_FOLDER, RECORDING_STATUS_COMPLETED, RECORDING_STATUS_FAILED,
    RECORDING_STATUS_PENDING, RECORDING_STATUS_PROCESSING,
};

// ── Constants ──────────────────────────────────────────────────────────────────

const AUDIO_FILE_NAME_PREFIX: &str = "audio";
pub(crate) const RECORDING_FRONTMATTER_TYPE: &str = "audio_recording";
const ASSEMBLY_UPLOAD_URL: &str = "https://api.assemblyai.com/v2/upload";
const ASSEMBLY_TRANSCRIPT_URL: &str = "https://api.assemblyai.com/v2/transcript";
const ASSEMBLY_SPEECH_MODEL: &str = "universal-2";
const ASSEMBLY_POLL_INTERVAL: Duration = Duration::from_secs(2);
const ASSEMBLY_MAX_POLL_ATTEMPTS: usize = 180;

pub(crate) const DEFAULT_WHISPER_MODEL: &str = "large-v3";

/// Python script executed as a subprocess for local whisper transcription.
const WHISPER_TRANSCRIBE_SCRIPT: &str = r#"
import sys, json

def main():
    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "large-v3"

    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="auto", compute_type="auto")
    segments, info = model.transcribe(audio_path, word_timestamps=True)

    text_parts = []
    words = []
    for segment in segments:
        text_parts.append(segment.text)
        if segment.words:
            for w in segment.words:
                words.append({
                    "word": w.word.strip(),
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                    "probability": round(w.probability, 3),
                })

    result = {
        "text": " ".join(text_parts).strip(),
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "duration": round(info.duration, 3),
        "words": words,
    }
    json.dump(result, sys.stdout, ensure_ascii=False)

main()
"#;

/// Lightweight check script — just verifies faster_whisper can be imported.
/// If a model is provided as an argument, it also tries to load it (which may trigger download).
const WHISPER_CHECK_SCRIPT: &str = r#"
import json, sys
try:
    from faster_whisper import WhisperModel
    model_size = sys.argv[1] if len(sys.argv) > 1 else None
    available = True
    error = None

    if model_size:
        try:
            # Try to load the model to verify it's available.
            # This will trigger a download if model_size is a name and not yet cached.
            # We use CPU and int8 for a lightweight check.
            WhisperModel(model_size, device="cpu", compute_type="int8", local_files_only=False)
        except Exception as e:
            available = False
            error = str(e)

    json.dump({"available": available, "error": error}, sys.stdout)
except Exception as e:
    available = False
    error = str(e)
    json.dump({"available": available, "error": error}, sys.stdout)
"#;

// ── Types ──────────────────────────────────────────────────────────────────────

/// Arguments for saving a new audio recording to disk.
#[derive(Deserialize)]
pub(crate) struct SaveRecordingArgs {
    pub(crate) audio_base64: String,
    pub(crate) mime_type: Option<String>,
    pub(crate) folder_path: Option<String>,
    #[serde(default)]
    pub(crate) file_name_format: NoteFileNameFormat,
}

/// Paths returned after successfully writing a recording note and audio file.
#[derive(Serialize)]
pub(crate) struct RecordingWriteResult {
    pub(crate) folder_path: String,
    pub(crate) note_path: String,
    pub(crate) audio_path: String,
}

/// Arguments for queuing transcription via AssemblyAI.
#[derive(Deserialize)]
pub(crate) struct QueueRecordingsArgs {
    pub(crate) assembly_api_key: String,
}

/// Arguments for queuing transcription via local Whisper.
#[derive(Deserialize)]
pub(crate) struct QueueLocalTranscriptionsArgs {
    #[serde(default = "default_whisper_model")]
    pub(crate) model: String,
}

fn default_whisper_model() -> String {
    DEFAULT_WHISPER_MODEL.to_string()
}

/// Arguments for re-triggering a single note's transcription.
#[derive(Deserialize)]
pub(crate) struct RetriggerTranscriptionArgs {
    pub(crate) note_path: String,
    pub(crate) model: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct CheckWhisperStatusArgs {
    pub(crate) model: Option<String>,
}

/// Summary returned after scanning and queuing recording notes for transcription.
#[derive(Serialize)]
pub(crate) struct RecordingTranscriptionQueueResult {
    pub(crate) scanned: usize,
    pub(crate) queued: usize,
    pub(crate) skipped: usize,
    pub(crate) in_flight: usize,
}

/// Current state of the transcription worker queue.
#[derive(Serialize)]
pub(crate) struct RecordingQueueSnapshot {
    pub(crate) running: bool,
    pub(crate) current_recording: Option<String>,
    pub(crate) pending: Vec<String>,
    pub(crate) in_flight: usize,
}

/// Single recording entry for the frontend recordings list.
#[derive(Serialize)]
pub(crate) struct RecordingListItem {
    pub(crate) note_path: String,
    pub(crate) folder_path: String,
    pub(crate) audio_path: Option<String>,
    pub(crate) status: String,
    pub(crate) error: Option<String>,
    pub(crate) updated_ms: Option<i64>,
    pub(crate) is_queued: bool,
    pub(crate) is_processing: bool,
}

/// Combined queue snapshot and recordings list for the frontend.
#[derive(Serialize)]
pub(crate) struct RecordingsListResult {
    pub(crate) queue: RecordingQueueSnapshot,
    pub(crate) recordings: Vec<RecordingListItem>,
}

/// Arguments for reading a recording's raw audio bytes.
#[derive(Deserialize)]
pub(crate) struct ReadRecordingAudioArgs {
    pub(crate) path: String,
}

/// Base64-encoded audio data with MIME type, returned to the frontend.
#[derive(Serialize)]
pub(crate) struct RecordingAudioPayload {
    pub(crate) mime_type: String,
    pub(crate) audio_base64: String,
}

/// Platform native recorder availability and state.
#[derive(Serialize)]
pub(crate) struct NativeRecorderCapabilities {
    pub(crate) supported: bool,
    pub(crate) recording: bool,
    pub(crate) started_ms: Option<i64>,
}

/// Local Whisper availability check result.
#[derive(Serialize)]
pub(crate) struct WhisperStatusResult {
    pub(crate) available: bool,
    pub(crate) python_found: bool,
    pub(crate) error: Option<String>,
}

/// Determines which transcription backend to use for a queued job.
#[derive(Clone)]
pub(crate) enum TranscriptionMethod {
    AssemblyAi { api_key: String },
    LocalWhisper { model: String },
}

/// A single pending transcription job in the queue.
#[derive(Clone)]
pub(crate) struct QueuedTranscriptionJob {
    pub(crate) note_rel: String,
    pub(crate) note_path: PathBuf,
    pub(crate) audio_path: PathBuf,
    pub(crate) method: TranscriptionMethod,
}

/// Parsed info for a recording note found during scanning.
#[derive(Clone)]
pub(crate) struct RecordingNoteInfo {
    pub(crate) note_rel: String,
    pub(crate) note_path: PathBuf,
    pub(crate) audio_rel: String,
    pub(crate) audio_path: PathBuf,
    pub(crate) status: String,
    pub(crate) error: Option<String>,
    pub(crate) updated_ms: Option<i64>,
}

/// In-memory state for the background transcription worker.
#[derive(Default)]
pub(crate) struct TranscriptionQueueState {
    pub(crate) running: bool,
    pub(crate) current_recording: Option<String>,
    pub(crate) pending: VecDeque<QueuedTranscriptionJob>,
    pub(crate) known_recordings: HashSet<String>,
}

#[derive(Deserialize)]
struct AssemblyUploadResponse {
    upload_url: String,
}

#[derive(Deserialize)]
struct AssemblyTranscriptResponse {
    id: String,
    status: String,
    text: Option<String>,
    error: Option<String>,
}

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

// ── Static ─────────────────────────────────────────────────────────────────────

static TRANSCRIPTION_QUEUE: OnceLock<Mutex<TranscriptionQueueState>> = OnceLock::new();

// ── Queue state ────────────────────────────────────────────────────────────────

/// Access the global transcription queue mutex.
pub(crate) fn transcription_queue_state() -> &'static Mutex<TranscriptionQueueState> {
    TRANSCRIPTION_QUEUE.get_or_init(|| Mutex::new(TranscriptionQueueState::default()))
}

/// Collect note paths that are currently queued or being transcribed.
pub(crate) fn active_transcription_note_paths() -> HashSet<String> {
    let queue = transcription_queue_state();
    let state = queue.lock().expect("transcription queue poisoned");
    let mut active = HashSet::with_capacity(state.pending.len() + 1);
    if let Some(current) = &state.current_recording {
        active.insert(current.clone());
    }
    active.extend(state.pending.iter().map(|job| job.note_rel.clone()));
    active
}

/// Snapshot the current queue state for the frontend.
pub(crate) fn recording_queue_snapshot() -> RecordingQueueSnapshot {
    let queue = transcription_queue_state();
    let state = queue.lock().expect("transcription queue poisoned");
    let pending = state
        .pending
        .iter()
        .map(|job| job.note_rel.clone())
        .collect::<Vec<_>>();
    RecordingQueueSnapshot {
        running: state.running,
        current_recording: state.current_recording.clone(),
        in_flight: pending.len() + usize::from(state.running),
        pending,
    }
}

// ── Audio helpers ──────────────────────────────────────────────────────────────

/// Map a MIME type to a file extension (defaults to "webm").
pub(crate) fn audio_extension_from_mime(mime_type: Option<&str>) -> &'static str {
    let Some(raw) = mime_type else {
        return "webm";
    };
    let normalized = raw.to_lowercase();
    if normalized.contains("mp4") || normalized.contains("aac") {
        return "m4a";
    }
    if normalized.contains("mpeg") || normalized.contains("mp3") {
        return "mp3";
    }
    if normalized.contains("wav") {
        return "wav";
    }
    if normalized.contains("ogg") {
        return "ogg";
    }
    if normalized.contains("flac") {
        return "flac";
    }
    "webm"
}

/// Infer MIME type from an audio file's extension.
pub(crate) fn audio_mime_from_path(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "m4a" => "audio/mp4",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "webm" => "audio/webm",
        "aac" => "audio/aac",
        "mp4" => "audio/mp4",
        "flac" => "audio/flac",
        _ => "application/octet-stream",
    }
}

/// Build the note body for a recording (transcript text or empty).
fn recording_note_body(status: &str, transcript: Option<&str>) -> String {
    if status != RECORDING_STATUS_COMPLETED {
        return String::new();
    }
    let value = transcript.unwrap_or_default().trim();
    if value.is_empty() {
        String::new()
    } else {
        format!("{}\n", value)
    }
}

fn recording_storage_root(root: &Path) -> PathBuf {
    root.join(RECORDINGS_STORAGE_FOLDER)
}

/// Verify that an audio path resolves inside the allowed storage folders.
pub(crate) fn is_recording_audio_path_allowed(root: &Path, audio_path: &Path) -> bool {
    audio_path.starts_with(recording_storage_root(root))
        || audio_path.starts_with(root.join(LEGACY_RECORDINGS_FOLDER))
}

// ── Note scanning ──────────────────────────────────────────────────────────────

fn recording_info_from_note_meta(
    root: &Path,
    note_path: &Path,
    note_rel: &str,
    meta: &NoteFrontMatter,
) -> Option<RecordingNoteInfo> {
    if meta.note_type.as_deref() != Some(RECORDING_FRONTMATTER_TYPE) {
        return None;
    }
    let audio_rel = meta.recording_audio_path.as_ref()?.trim();
    if audio_rel.is_empty() {
        return None;
    }
    let audio_rel_path = sanitize_relative(audio_rel).ok()?;
    let audio_path = root.join(&audio_rel_path);
    if !is_recording_audio_path_allowed(root, &audio_path) {
        return None;
    }
    let status = meta
        .transcription_status
        .as_deref()
        .unwrap_or(RECORDING_STATUS_PENDING)
        .to_string();
    Some(RecordingNoteInfo {
        note_rel: note_rel.to_string(),
        note_path: note_path.to_path_buf(),
        audio_rel: audio_rel_path.to_string_lossy().replace('\\', "/"),
        audio_path,
        status,
        error: meta.transcription_error.clone(),
        updated_ms: meta.transcription_updated_ms.or(meta.updated_ms),
    })
}

/// Scan all markdown notes and extract recording metadata.
pub(crate) fn collect_recording_notes(root: &Path) -> Result<Vec<RecordingNoteInfo>, String> {
    let mut note_files = Vec::new();
    collect_markdown_note_files(root, root, &mut note_files)?;
    let mut recordings = Vec::new();
    for note_path in note_files {
        let raw = match fs::read_to_string(&note_path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let (meta, _) = parse_note_front_matter(&raw);
        let note_rel = strip_root(root, &note_path);
        if let Some(info) = recording_info_from_note_meta(root, &note_path, &note_rel, &meta) {
            recordings.push(info);
        }
    }
    Ok(recordings)
}

/// Update a recording note's transcription status and body on disk.
pub(crate) fn update_recording_note_status(
    note_path: &Path,
    status: &str,
    error: Option<String>,
    transcript_id: Option<String>,
    transcript_text: Option<&str>,
) -> Result<(), String> {
    let raw = fs::read_to_string(note_path).map_err(|issue| issue.to_string())?;
    let (mut meta, _) = parse_note_front_matter(&raw);
    if meta.id.is_none() {
        meta.id = Some(generate_note_id());
    }
    let now = now_ms();
    if meta.created_ms.is_none() {
        meta.created_ms = now;
    }
    meta.updated_ms = now.or(meta.updated_ms);
    meta.note_type = Some(RECORDING_FRONTMATTER_TYPE.to_string());
    meta.transcription_status = Some(status.to_string());
    meta.transcription_error = error.clone();
    meta.transcription_updated_ms = now.or(meta.transcription_updated_ms);
    meta.transcription_id = transcript_id;
    let next_body = recording_note_body(status, transcript_text);
    write_note_with_front_matter(note_path, &meta, &next_body)
}

// ── Local Whisper transcription ────────────────────────────────────────────────

/// Find python3 binary. Tries `python3` first, then `python`.
fn find_python() -> Option<String> {
    for candidate in &["python3", "python"] {
        if Command::new(candidate)
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return Some(candidate.to_string());
        }
    }
    None
}

/// Check whether faster-whisper is available in the system Python.
pub(crate) fn check_whisper_availability(model: Option<&str>) -> WhisperStatusResult {
    let python = match find_python() {
        Some(p) => p,
        None => {
            return WhisperStatusResult {
                available: false,
                python_found: false,
                error: Some("python3 not found in PATH".to_string()),
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

/// Transcribe audio using local faster-whisper via Python subprocess.
/// Returns (plain_text, full_json_string_with_words).
fn transcribe_audio_local_whisper(
    audio_path: &Path,
    model: &str,
) -> Result<(String, String), String> {
    let python = find_python()
        .ok_or_else(|| "python3 not found in PATH. Install Python 3 to use local transcription.".to_string())?;

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

    let output = Command::new(&python)
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
fn save_word_level_json(audio_path: &Path, json_content: &str) -> Result<PathBuf, String> {
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

// ── AssemblyAI transcription ───────────────────────────────────────────────────

fn transcribe_audio_bytes_with_assembly(
    audio_bytes: Vec<u8>,
    api_key: &str,
) -> Result<(String, String), String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())?;

    let upload_response = client
        .post(ASSEMBLY_UPLOAD_URL)
        .header("authorization", api_key)
        .header("content-type", "application/octet-stream")
        .body(audio_bytes)
        .send()
        .map_err(|error| format!("AssemblyAI upload request failed: {}", error))?;
    if !upload_response.status().is_success() {
        let status = upload_response.status();
        let body = upload_response.text().unwrap_or_default();
        return Err(response_error(status, body, "AssemblyAI upload"));
    }
    let upload_payload = upload_response
        .json::<AssemblyUploadResponse>()
        .map_err(|error| format!("AssemblyAI upload response parse failed: {}", error))?;

    let transcript_create_response = client
        .post(ASSEMBLY_TRANSCRIPT_URL)
        .header("authorization", api_key)
        .json(&serde_json::json!({
            "audio_url": upload_payload.upload_url,
            "speech_models": [ASSEMBLY_SPEECH_MODEL]
        }))
        .send()
        .map_err(|error| format!("AssemblyAI transcript request failed: {}", error))?;
    if !transcript_create_response.status().is_success() {
        let status = transcript_create_response.status();
        let body = transcript_create_response.text().unwrap_or_default();
        return Err(response_error(
            status,
            body,
            "AssemblyAI transcript request",
        ));
    }
    let transcript_create_payload = transcript_create_response
        .json::<AssemblyTranscriptResponse>()
        .map_err(|error| format!("AssemblyAI transcript response parse failed: {}", error))?;
    let transcript_id = transcript_create_payload.id;

    for _ in 0..ASSEMBLY_MAX_POLL_ATTEMPTS {
        thread::sleep(ASSEMBLY_POLL_INTERVAL);
        let poll_response = client
            .get(format!("{}/{}", ASSEMBLY_TRANSCRIPT_URL, transcript_id))
            .header("authorization", api_key)
            .send()
            .map_err(|error| format!("AssemblyAI polling request failed: {}", error))?;
        if !poll_response.status().is_success() {
            let status = poll_response.status();
            let body = poll_response.text().unwrap_or_default();
            return Err(response_error(status, body, "AssemblyAI polling"));
        }
        let poll_payload = poll_response
            .json::<AssemblyTranscriptResponse>()
            .map_err(|error| format!("AssemblyAI polling response parse failed: {}", error))?;
        match poll_payload.status.as_str() {
            "completed" => {
                let transcript_text = poll_payload.text.unwrap_or_default();
                return Ok((transcript_text, transcript_id));
            }
            "error" => {
                return Err(poll_payload
                    .error
                    .unwrap_or_else(|| "AssemblyAI reported a transcription error.".to_string()));
            }
            _ => {}
        }
    }
    Err("AssemblyAI transcription timed out.".to_string())
}

// ── Worker ─────────────────────────────────────────────────────────────────────

fn process_transcription_job(job: QueuedTranscriptionJob) {
    if let Err(error) = update_recording_note_status(
        &job.note_path,
        RECORDING_STATUS_PROCESSING,
        None,
        None,
        None,
    ) {
        eprintln!(
            "[recordings] failed to mark processing for {}: {}",
            job.note_rel, error
        );
    }

    let result = match &job.method {
        TranscriptionMethod::LocalWhisper { model } => {
            transcribe_audio_local_whisper(&job.audio_path, model)
        }
        TranscriptionMethod::AssemblyAi { api_key } => {
            let audio_bytes = match fs::read(&job.audio_path) {
                Ok(bytes) => bytes,
                Err(e) => {
                    let _ = update_recording_note_status(
                        &job.note_path,
                        RECORDING_STATUS_FAILED,
                        Some(e.to_string()),
                        None,
                        None,
                    );
                    eprintln!(
                        "[recordings] failed to read audio for {}: {}",
                        job.note_rel, e
                    );
                    return;
                }
            };
            transcribe_audio_bytes_with_assembly(audio_bytes, api_key)
        }
    };

    match result {
        Ok((transcript, id_or_json)) => {
            // For local whisper, id_or_json is the full JSON with word timestamps.
            // Save word-level JSON alongside the audio file.
            if matches!(job.method, TranscriptionMethod::LocalWhisper { .. }) {
                if let Err(e) = save_word_level_json(&job.audio_path, &id_or_json) {
                    eprintln!(
                        "[recordings] failed to save word-level JSON for {}: {}",
                        job.note_rel, e
                    );
                }
            }

            let transcript_id = match &job.method {
                TranscriptionMethod::AssemblyAi { .. } => Some(id_or_json),
                TranscriptionMethod::LocalWhisper { .. } => None,
            };

            if let Err(error) = update_recording_note_status(
                &job.note_path,
                RECORDING_STATUS_COMPLETED,
                None,
                transcript_id,
                Some(&transcript),
            ) {
                eprintln!(
                    "[recordings] failed to write transcript for {}: {}",
                    job.note_rel, error
                );
            }
        }
        Err(error) => {
            let _ = update_recording_note_status(
                &job.note_path,
                RECORDING_STATUS_FAILED,
                Some(error.clone()),
                None,
                None,
            );
            eprintln!(
                "[recordings] transcription failed for {}: {}",
                job.note_rel, error
            );
        }
    }
}

/// Start a background worker thread if jobs are queued and none is running.
pub(crate) fn spawn_transcription_worker_if_needed() {
    let should_spawn = {
        let queue = transcription_queue_state();
        let mut state = queue.lock().expect("transcription queue poisoned");
        if state.running || state.pending.is_empty() {
            false
        } else {
            state.running = true;
            true
        }
    };
    if !should_spawn {
        return;
    }
    thread::spawn(move || loop {
        let maybe_job = {
            let queue = transcription_queue_state();
            let mut state = queue.lock().expect("transcription queue poisoned");
            match state.pending.pop_front() {
                Some(job) => {
                    state.current_recording = Some(job.note_rel.clone());
                    Some(job)
                }
                None => {
                    state.running = false;
                    state.current_recording = None;
                    None
                }
            }
        };
        let Some(job) = maybe_job else {
            break;
        };
        process_transcription_job(job.clone());
        let queue = transcription_queue_state();
        let mut state = queue.lock().expect("transcription queue poisoned");
        state.known_recordings.remove(&job.note_rel);
        if state.current_recording.as_deref() == Some(job.note_rel.as_str()) {
            state.current_recording = None;
        }
    });
}

// ── Queue helpers for local transcription ──────────────────────────────────────

/// Queue all pending recordings for local whisper transcription (desktop only).
pub(crate) fn queue_recordings_for_local_transcription(
    root: &Path,
    model: &str,
) -> Result<RecordingTranscriptionQueueResult, String> {
    let recordings = collect_recording_notes(root)?;
    let active_recordings = active_transcription_note_paths();
    let mut scanned = 0usize;
    let mut skipped = 0usize;
    let mut candidates = Vec::new();

    for recording in recordings {
        scanned += 1;
        if !recording.audio_path.exists() {
            let _ = update_recording_note_status(
                &recording.note_path,
                RECORDING_STATUS_FAILED,
                Some("Audio file is missing.".to_string()),
                None,
                None,
            );
            skipped += 1;
            continue;
        }

        let status = recording.status.as_str();
        let is_active = active_recordings.contains(&recording.note_rel);

        if status == RECORDING_STATUS_COMPLETED {
            skipped += 1;
            continue;
        }

        if matches!(
            status,
            crate::RECORDING_STATUS_QUEUED | RECORDING_STATUS_PROCESSING
        ) && is_active
        {
            skipped += 1;
            continue;
        }

        update_recording_note_status(
            &recording.note_path,
            crate::RECORDING_STATUS_QUEUED,
            None,
            None,
            None,
        )?;
        candidates.push(QueuedTranscriptionJob {
            note_rel: recording.note_rel,
            note_path: recording.note_path,
            audio_path: recording.audio_path,
            method: TranscriptionMethod::LocalWhisper {
                model: model.to_string(),
            },
        });
    }

    let queued = {
        let queue = transcription_queue_state();
        let mut state = queue.lock().expect("transcription queue poisoned");
        let mut added = 0usize;
        for job in candidates {
            if state.known_recordings.contains(&job.note_rel) {
                continue;
            }
            state.known_recordings.insert(job.note_rel.clone());
            state.pending.push_back(job);
            added += 1;
        }
        added
    };

    spawn_transcription_worker_if_needed();

    let in_flight = {
        let queue = transcription_queue_state();
        let state = queue.lock().expect("transcription queue poisoned");
        state.pending.len() + usize::from(state.running)
    };

    Ok(RecordingTranscriptionQueueResult {
        scanned,
        queued,
        skipped,
        in_flight,
    })
}

/// Reset a single recording's status and re-queue it for local transcription.
pub(crate) fn retrigger_single_transcription(
    root: &Path,
    note_rel: &str,
    model: &str,
) -> Result<(), String> {
    let note_path = root.join(note_rel);
    if !note_path.exists() {
        return Err(format!("Note not found: {}", note_rel));
    }
    let raw = fs::read_to_string(&note_path).map_err(|e| e.to_string())?;
    let (meta, _) = parse_note_front_matter(&raw);
    let info = recording_info_from_note_meta(root, &note_path, note_rel, &meta)
        .ok_or_else(|| format!("Not a recording note: {}", note_rel))?;

    if !info.audio_path.exists() {
        return Err("Audio file is missing.".to_string());
    }

    // Reset status to queued
    update_recording_note_status(&note_path, crate::RECORDING_STATUS_QUEUED, None, None, None)?;

    // Add to queue
    {
        let queue = transcription_queue_state();
        let mut state = queue.lock().expect("transcription queue poisoned");
        // Remove from known so it can be re-queued
        state.known_recordings.remove(note_rel);
        state.known_recordings.insert(note_rel.to_string());
        state.pending.push_back(QueuedTranscriptionJob {
            note_rel: note_rel.to_string(),
            note_path,
            audio_path: info.audio_path,
            method: TranscriptionMethod::LocalWhisper {
                model: model.to_string(),
            },
        });
    }

    spawn_transcription_worker_if_needed();
    Ok(())
}

// ── File allocation ────────────────────────────────────────────────────────────

/// Default body for a newly created recording note (empty).
pub(crate) fn recording_initial_body() -> String {
    String::new()
}

/// Generate a unique filename for a recording note.
pub(crate) fn recording_note_file_name(
    folder: &Path,
    timestamp_ms: i64,
    note_id: &str,
    file_name_format: NoteFileNameFormat,
) -> Result<String, String> {
    let fallback = format!("recording-{}", uuid_tail_without_timestamp_prefix(note_id));
    allocate_note_file_name(
        folder,
        timestamp_ms,
        note_id,
        "",
        &fallback,
        file_name_format,
    )
}

/// Allocate a unique audio file path inside the Recordings storage folder.
pub(crate) fn recording_audio_file_path(root: &Path, extension: &str) -> Result<PathBuf, String> {
    let storage = recording_storage_root(root);
    fs::create_dir_all(&storage).map_err(|error| error.to_string())?;
    for _ in 0..=512usize {
        let candidate = storage.join(format!(
            "{}-{}.{}",
            AUDIO_FILE_NAME_PREFIX,
            Uuid::now_v7(),
            extension
        ));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Failed to allocate recording audio filename.".to_string())
}

/// Resolve the target folder for a new recording, falling back to Feed.
pub(crate) fn resolve_recording_target_folder(
    app: &tauri::AppHandle,
    requested: Option<&str>,
) -> Result<(String, PathBuf), String> {
    let root = notes_root(app)?;
    let candidate = requested.unwrap_or("").trim();
    if !candidate.is_empty() {
        let path = resolve_path(app, candidate)?;
        if path.exists() && path.is_dir() && !is_storage_folder_path(&root, &path) {
            return Ok((strip_root(&root, &path), path));
        }
    }
    let fallback = root.join(FEED_FOLDER);
    Ok((FEED_FOLDER.to_string(), fallback))
}
