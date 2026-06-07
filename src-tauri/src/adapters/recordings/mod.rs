//! Audio recording: save, transcription queue (local Whisper + AssemblyAI fallback), listing.

use serde::{Deserialize, Serialize};
use std::{
    collections::{HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    thread,
};
use uuid::Uuid;

use crate::ports::recordings::RecordingsGateway;
use crate::{
    allocate_note_file_name, collect_markdown_note_files, decode_audio_base64, generate_note_id,
    is_storage_folder_path, note_parent_folder_path, notes_root, now_ms, parse_note_front_matter,
    resolve_path, sanitize_relative, strip_root, uuid_tail_without_timestamp_prefix,
    write_note_with_front_matter, NoteFileNameFormat, NoteFrontMatter, BASE64, FEED_FOLDER,
    LEGACY_RECORDINGS_FOLDER, RECORDINGS_STORAGE_FOLDER, RECORDING_STATUS_COMPLETED,
    RECORDING_STATUS_FAILED, RECORDING_STATUS_PENDING, RECORDING_STATUS_PROCESSING,
};
use base64::Engine as _;

#[cfg(target_os = "ios")]
use crate::{msg_send, Object};

// Transcription backends — the worker below dispatches to whichever the job
// selects (local Whisper on desktop, AssemblyAI on iOS).
mod assembly;
mod whisper;
pub(crate) use assembly::transcribe_audio_bytes_with_assembly;
pub(crate) use whisper::{
    check_whisper_availability, save_word_level_json, transcribe_audio_local_whisper,
};

// ── Constants ──────────────────────────────────────────────────────────────────

const AUDIO_FILE_NAME_PREFIX: &str = "audio";
pub(crate) const RECORDING_FRONTMATTER_TYPE: &str = "audio_recording";

pub(crate) const DEFAULT_WHISPER_MODEL: &str = "large-v3";

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
    pub(crate) assembly_api_key: Option<String>,
}

/// Arguments for queuing transcription via local Whisper.
#[derive(Deserialize)]
pub(crate) struct QueueLocalTranscriptionsArgs {
    pub(crate) model: Option<String>,
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
    /// When true, provision the managed env (and download the model) instead of
    /// only probing readiness. Driven by the explicit "Set up" button.
    #[serde(default)]
    pub(crate) setup: bool,
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
    AssemblyAi {
        api_key: String,
    },
    /// Local faster-whisper running in the app-managed Python environment.
    /// Carries an `AppHandle` so the worker can provision the env lazily.
    LocalWhisper {
        model: String,
        app: tauri::AppHandle,
    },
}

/// A single pending transcription job in the queue.
#[derive(Clone)]
pub(crate) struct QueuedTranscriptionJob {
    pub(crate) note_rel: String,
    pub(crate) note_path: PathBuf,
    pub(crate) audio_path: PathBuf,
    pub(crate) method: TranscriptionMethod,
}

/// Tauri-backed recordings gateway. It owns native-recorder state, note/audio
/// filesystem writes, and background transcription queue mutation.
pub(crate) struct TauriRecordingsAdapter {
    app: tauri::AppHandle,
}

impl TauriRecordingsAdapter {
    pub(crate) fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl RecordingsGateway for TauriRecordingsAdapter {
    type NativeCapabilities = NativeRecorderCapabilities;
    type AudioPayload = RecordingAudioPayload;
    type SaveArgs = SaveRecordingArgs;
    type WriteResult = RecordingWriteResult;
    type CloudQueueArgs = QueueRecordingsArgs;
    type LocalQueueArgs = QueueLocalTranscriptionsArgs;
    type QueueResult = RecordingTranscriptionQueueResult;
    type RetriggerArgs = RetriggerTranscriptionArgs;
    type WhisperArgs = CheckWhisperStatusArgs;
    type WhisperStatus = WhisperStatusResult;
    type ListResult = RecordingsListResult;
    type ReadArgs = ReadRecordingAudioArgs;

    fn native_capabilities(&self) -> Result<Self::NativeCapabilities, String> {
        #[cfg(target_os = "ios")]
        {
            let (recording, started_ms) = crate::ios_native_recorder_state()
                .lock()
                .map(|guard| {
                    let Some(state) = guard.as_ref() else {
                        return (false, None);
                    };
                    let recorder = state.recorder_ptr as *mut Object;
                    let resumed = crate::ios_ensure_recorder_active(recorder);
                    (resumed, state.started_ms)
                })
                .unwrap_or((false, None));
            return Ok(NativeRecorderCapabilities {
                supported: true,
                recording,
                started_ms,
            });
        }

        #[cfg(not(target_os = "ios"))]
        {
            Ok(NativeRecorderCapabilities {
                supported: false,
                recording: false,
                started_ms: None,
            })
        }
    }

    fn start_native(&self) -> Result<(), String> {
        #[cfg(target_os = "ios")]
        {
            let mut guard = crate::ios_native_recorder_state()
                .lock()
                .map_err(|_| "Native recorder state lock poisoned.".to_string())?;
            if guard.is_some() {
                return Err("Native audio recorder is already active.".to_string());
            }
            let output_path = crate::next_native_recording_path(&self.app)?;
            crate::ensure_avfoundation_loaded()?;
            crate::configure_ios_audio_for_recording()?;
            let recorder = crate::create_ios_audio_recorder(&output_path).inspect_err(|_| {
                crate::deactivate_ios_audio();
            })?;

            *guard = Some(crate::IosNativeRecorderState {
                recorder_ptr: recorder as usize,
                output_path,
                mime_type: crate::IOS_AUDIO_MIME_TYPE.to_string(),
                started_ms: now_ms(),
            });
            Ok(())
        }

        #[cfg(not(target_os = "ios"))]
        {
            Err("Native iOS audio recorder is unavailable on this platform.".to_string())
        }
    }

    fn stop_native(&self) -> Result<Self::AudioPayload, String> {
        #[cfg(target_os = "ios")]
        {
            let state = {
                let mut guard = crate::ios_native_recorder_state()
                    .lock()
                    .map_err(|_| "Native recorder state lock poisoned.".to_string())?;
                guard
                    .take()
                    .ok_or_else(|| "Native audio recorder is not active.".to_string())?
            };

            unsafe {
                let recorder = state.recorder_ptr as *mut Object;
                let _: () = msg_send![recorder, stop];
                let _: () = msg_send![recorder, release];
            }
            crate::deactivate_ios_audio();

            let audio_bytes = fs::read(&state.output_path).map_err(|error| error.to_string())?;
            let _ = fs::remove_file(&state.output_path);
            if audio_bytes.is_empty() {
                return Err("Native recorder returned an empty audio file.".to_string());
            }

            return Ok(RecordingAudioPayload {
                mime_type: state.mime_type,
                audio_base64: BASE64.encode(audio_bytes),
            });
        }

        #[cfg(not(target_os = "ios"))]
        {
            Err("Native iOS audio recorder is unavailable on this platform.".to_string())
        }
    }

    fn save(&self, args: Self::SaveArgs) -> Result<Self::WriteResult, String> {
        let root = crate::ensured_notes_root(&self.app)?;
        let audio_bytes = decode_audio_base64(&args.audio_base64)?;
        if audio_bytes.is_empty() {
            return Err("Audio payload is empty.".to_string());
        }

        let (target_folder_rel, target_folder_path) =
            resolve_recording_target_folder(&self.app, args.folder_path.as_deref())?;
        let extension = audio_extension_from_mime(args.mime_type.as_deref());
        let audio_path = recording_audio_file_path(&root, extension)?;
        fs::write(&audio_path, audio_bytes).map_err(|error| error.to_string())?;

        let now = now_ms().unwrap_or(0);
        let note_id = generate_note_id();
        let note_file_name =
            recording_note_file_name(&target_folder_path, now, &note_id, args.file_name_format)?;
        let note_path = target_folder_path.join(&note_file_name);
        let mut meta = NoteFrontMatter::default();
        meta.id = Some(note_id);
        meta.created_ms = Some(now);
        meta.updated_ms = Some(now);
        meta.note_type = Some(RECORDING_FRONTMATTER_TYPE.to_string());
        meta.recording_audio_path = Some(strip_root(&root, &audio_path));
        meta.transcription_status = Some(RECORDING_STATUS_PENDING.to_string());
        meta.transcription_error = None;
        meta.transcription_updated_ms = Some(now);
        meta.transcription_id = None;

        write_note_with_front_matter(&note_path, &meta, &recording_initial_body())?;
        if !crate::is_feed_folder_path(&root, &target_folder_path) {
            crate::update_order_append(&target_folder_path, &[note_file_name], false)?;
        }

        Ok(RecordingWriteResult {
            folder_path: target_folder_rel,
            note_path: strip_root(&root, &note_path),
            audio_path: strip_root(&root, &audio_path),
        })
    }

    fn queue_cloud(&self, args: Self::CloudQueueArgs) -> Result<Self::QueueResult, String> {
        let app_data = crate::app_data_dir(&self.app)?;
        let app_config = crate::load_app_config(&app_data);

        let api_key = args
            .assembly_api_key
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(app_config.assemblyai_api_key.as_str())
            .trim();

        if api_key.is_empty() {
            return Err("AssemblyAI API key is required.".to_string());
        }

        let root = crate::ensured_notes_root(&self.app)?;
        let recordings = collect_recording_notes(&root)?;
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
            let is_active_recording = active_recordings.contains(&recording.note_rel);
            if status == RECORDING_STATUS_COMPLETED {
                skipped += 1;
                continue;
            }
            if matches!(
                status,
                crate::RECORDING_STATUS_QUEUED | RECORDING_STATUS_PROCESSING
            ) && is_active_recording
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
                method: TranscriptionMethod::AssemblyAi {
                    api_key: api_key.to_string(),
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
        let in_flight = recording_queue_snapshot().in_flight;

        Ok(RecordingTranscriptionQueueResult {
            scanned,
            queued,
            skipped,
            in_flight,
        })
    }

    fn queue_local(&self, args: Self::LocalQueueArgs) -> Result<Self::QueueResult, String> {
        let app_data = crate::app_data_dir(&self.app)?;
        let app_config = crate::load_app_config(&app_data);

        let model = args
            .model
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(app_config.whisper_model.as_str())
            .trim();

        if model.is_empty() {
            return Err("Whisper model is required.".to_string());
        }

        let root = crate::ensured_notes_root(&self.app)?;
        queue_recordings_for_local_transcription(&self.app, &root, model)
    }

    fn retrigger(&self, args: Self::RetriggerArgs) -> Result<(), String> {
        let root = crate::ensured_notes_root(&self.app)?;
        let note_rel = args.note_path.trim();
        if note_rel.is_empty() {
            return Err("Note path is required.".to_string());
        }
        let model = args.model.as_deref().unwrap_or(DEFAULT_WHISPER_MODEL);
        retrigger_single_transcription(&self.app, &root, note_rel, model)
    }

    fn whisper_status(&self, args: Self::WhisperArgs) -> Self::WhisperStatus {
        check_whisper_availability(&self.app, args.model.as_deref(), args.setup)
    }

    fn list(&self) -> Result<Self::ListResult, String> {
        let root = crate::ensured_notes_root(&self.app)?;
        let queue = recording_queue_snapshot();
        let pending_set = queue
            .pending
            .iter()
            .map(String::as_str)
            .collect::<HashSet<_>>();

        let mut recordings = collect_recording_notes(&root)?
            .into_iter()
            .map(|recording| {
                let folder_path = note_parent_folder_path(&recording.note_rel);
                let audio_exists = recording.audio_path.exists();
                let mut error = recording.error.clone();
                if !audio_exists {
                    error = Some("Audio file is missing.".to_string());
                }
                RecordingListItem {
                    note_path: recording.note_rel.clone(),
                    folder_path,
                    audio_path: if audio_exists {
                        Some(recording.audio_rel.clone())
                    } else {
                        None
                    },
                    status: recording.status.clone(),
                    error,
                    updated_ms: recording.updated_ms,
                    is_queued: pending_set.contains(recording.note_rel.as_str()),
                    is_processing: queue.current_recording.as_deref()
                        == Some(recording.note_rel.as_str()),
                }
            })
            .collect::<Vec<_>>();

        recordings.sort_by(|a, b| b.updated_ms.unwrap_or(0).cmp(&a.updated_ms.unwrap_or(0)));
        Ok(RecordingsListResult { queue, recordings })
    }

    fn read_audio(&self, args: Self::ReadArgs) -> Result<Self::AudioPayload, String> {
        let root = crate::ensured_notes_root(&self.app)?;
        let path_rel = sanitize_relative(&args.path)?;
        let audio_path = root.join(path_rel);
        if !is_recording_audio_path_allowed(&root, &audio_path) {
            return Err("Only files inside recordings storage are allowed.".to_string());
        }
        if !audio_path.exists() || !audio_path.is_file() {
            return Err("Audio file not found.".to_string());
        }
        let bytes = fs::read(&audio_path).map_err(|error| error.to_string())?;
        Ok(RecordingAudioPayload {
            mime_type: audio_mime_from_path(&audio_path).to_string(),
            audio_base64: BASE64.encode(bytes),
        })
    }
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
        TranscriptionMethod::LocalWhisper { model, app } => {
            // Provision the managed Python env on first use; subsequent jobs are
            // instant. Any setup failure surfaces as the note's transcription error.
            match crate::ensure_whisper_env(app) {
                Ok(python) => transcribe_audio_local_whisper(&job.audio_path, model, &python),
                Err(error) => Err(format!("Failed to set up local transcription: {error}")),
            }
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
    app: &tauri::AppHandle,
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
                app: app.clone(),
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
    app: &tauri::AppHandle,
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
                app: app.clone(),
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
