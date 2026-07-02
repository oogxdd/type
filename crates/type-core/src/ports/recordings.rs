use serde::Serialize;

use super::notes::NoteFileNameFormat;

// ── Types ──────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct RecordingWriteResult {
    pub folder_path: String,
    pub note_path: String,
    pub audio_path: String,
}

#[derive(Serialize)]
pub struct TranscriptionQueueResult {
    pub scanned: usize,
    pub queued: usize,
    pub skipped: usize,
    pub in_flight: usize,
}

#[derive(Serialize)]
pub struct RecordingQueueSnapshot {
    pub running: bool,
    pub current_recording: Option<String>,
    pub pending: Vec<String>,
    pub in_flight: usize,
}

#[derive(Serialize)]
pub struct RecordingListItem {
    pub note_path: String,
    pub folder_path: String,
    pub audio_path: Option<String>,
    pub status: String,
    pub error: Option<String>,
    pub updated_ms: Option<i64>,
    pub is_queued: bool,
    pub is_processing: bool,
}

#[derive(Serialize)]
pub struct RecordingsListResult {
    pub queue: RecordingQueueSnapshot,
    pub recordings: Vec<RecordingListItem>,
}

#[derive(Serialize)]
pub struct RecordingAudioPayload {
    pub mime_type: String,
    pub audio_base64: String,
}

#[derive(Serialize)]
pub struct NativeRecorderCapabilities {
    pub supported: bool,
    pub recording: bool,
    pub started_ms: Option<i64>,
}

#[derive(Serialize)]
pub struct WhisperStatus {
    pub available: bool,
    pub python_found: bool,
    pub error: Option<String>,
}

// ── Trait ──────────────────────────────────────────────────────────────────────

/// A pluggable transcription backend supplied by a shell.
///
/// The built-in backends (local Whisper, AssemblyAI) are hardwired into the
/// queue worker, but shells can register their own — the mobile FFI exposes
/// this trait as a foreign interface so React Native / Swift / Kotlin can plug
/// in e.g. Apple's on-device speech recognizer without touching core. Jobs
/// queued with a provider run on the same sequential worker and share the
/// pending → queued → processing → completed | failed note lifecycle.
pub trait TranscriptionProvider: Send + Sync {
    /// Stable identifier for diagnostics, e.g. "assemblyai", "apple-speech".
    fn id(&self) -> String;
    /// Transcribe the audio file at `audio_path` and return the transcript.
    fn transcribe(&self, audio_path: &std::path::Path) -> Result<String, String>;
}

pub trait RecordingService {
    fn save_recording(
        &self,
        audio_base64: &str,
        mime_type: Option<&str>,
        folder_path: Option<&str>,
        file_name_format: NoteFileNameFormat,
    ) -> Result<RecordingWriteResult, String>;
    fn queue_transcriptions_assembly(
        &self,
        api_key: &str,
    ) -> Result<TranscriptionQueueResult, String>;
    fn queue_transcriptions_local(&self, model: &str) -> Result<TranscriptionQueueResult, String>;
    fn retrigger_transcription(&self, note_path: &str) -> Result<(), String>;
    fn list_recordings(&self) -> Result<RecordingsListResult, String>;
    fn read_recording_audio(&self, path: &str) -> Result<RecordingAudioPayload, String>;
    fn check_whisper_status(&self) -> WhisperStatus;
    fn native_recorder_capabilities(&self) -> Result<NativeRecorderCapabilities, String>;
    fn start_native_recording(&self) -> Result<(), String>;
    fn stop_native_recording(&self) -> Result<RecordingAudioPayload, String>;
}

/// Internal gateway for recording storage, native capture, and queue workers.
pub trait RecordingsGateway {
    type NativeCapabilities;
    type AudioPayload;
    type SaveArgs;
    type WriteResult;
    type CloudQueueArgs;
    type LocalQueueArgs;
    type QueueResult;
    type RetriggerArgs;
    type WhisperArgs;
    type WhisperStatus;
    type ListResult;
    type ReadArgs;

    fn native_capabilities(&self) -> Result<Self::NativeCapabilities, String>;
    fn start_native(&self) -> Result<(), String>;
    fn stop_native(&self) -> Result<Self::AudioPayload, String>;
    fn save(&self, args: Self::SaveArgs) -> Result<Self::WriteResult, String>;
    fn queue_cloud(&self, args: Self::CloudQueueArgs) -> Result<Self::QueueResult, String>;
    fn queue_local(&self, args: Self::LocalQueueArgs) -> Result<Self::QueueResult, String>;
    fn retrigger(&self, args: Self::RetriggerArgs) -> Result<(), String>;
    fn whisper_status(&self, args: Self::WhisperArgs) -> Self::WhisperStatus;
    fn list(&self) -> Result<Self::ListResult, String>;
    fn read_audio(&self, args: Self::ReadArgs) -> Result<Self::AudioPayload, String>;
}

// ─── Implementation Notes ─────────────────────────────────────────────────────
//
// RecordingService handles audio recording, storage, and transcription.
//
// save_recording(audio_base64, mime_type, folder_path, file_name_format)
//   in:  audio_base64 — base64-encoded audio bytes (may have data URI prefix)
//        mime_type — e.g. "audio/webm", "audio/mp4". Defaults to webm
//        folder_path — where to create the note, defaults to "Feed"
//        file_name_format — how to name the note file
//   out: RecordingWriteResult — folder_path, note_path, audio_path (all relative)
//   - Decodes the base64 audio and saves to Recordings/ storage folder
//   - Audio filename: audio-{uuid}.{ext}
//   - Creates a markdown note with front-matter linking to the audio file
//   - Front-matter includes: type="audio_recording", recording_audio_path, transcription_status="pending"
//   - MIME to extension mapping: mp4/aac→m4a, mpeg/mp3→mp3, wav→wav, ogg→ogg, flac→flac, default→webm
//
// queue_transcriptions_assembly(api_key)
//   in:  api_key — AssemblyAI API key
//   out: TranscriptionQueueResult — how many scanned, queued, skipped, in flight
//   - Scans all recording notes, skips completed or already-in-flight ones
//   - Queues pending/failed recordings for AssemblyAI transcription
//   - AssemblyAI flow: upload audio → create transcript → poll every 2s (max 6 min)
//   - Speech model: "universal-2"
//   - On completion, writes transcript text as the note body
//
// queue_transcriptions_local(model)
//   in:  model — whisper model name, e.g. "large-v3", "tiny", "base", "small", "medium"
//   out: TranscriptionQueueResult
//   - Same scanning logic as assembly, but uses local faster-whisper via Python subprocess
//   - Saves word-level JSON alongside the audio file ({stem}.transcription.json)
//   - Requires python3 + faster_whisper installed on the system
//
// retrigger_transcription(note_path)
//   in:  note_path — relative path to the recording note
//   out: nothing
//   - Resets the note's transcription status to "queued" and re-adds it to the queue
//   - Uses local whisper with default model
//
// list_recordings()
//   in:  nothing
//   out: RecordingsListResult — queue snapshot + list of all recording notes with status
//   - Sorted by updated_ms descending (newest first)
//   - Each item includes whether it's currently queued or being processed
//
// read_recording_audio(path)
//   in:  path — relative path to the audio file (must be inside Recordings/ storage)
//   out: RecordingAudioPayload — mime_type + audio_base64
//   - Only allows reading from the Recordings storage folder (security boundary)
//
// check_whisper_status()
//   in:  nothing
//   out: WhisperStatus — whether python3 and faster_whisper are available
//   - Runs a lightweight check script to verify the import works
//
// native_recorder_capabilities()
//   in:  nothing
//   out: NativeRecorderCapabilities — whether native recording is supported, active, and when it started
//   - iOS only: uses AVAudioRecorder for high-quality m4a recording
//   - Other platforms: returns supported=false
//
// start_native_recording()
//   in:  nothing
//   out: nothing
//   - iOS only: configures AVAudioSession, creates AVAudioRecorder, starts recording
//   - Fails if already recording
//
// stop_native_recording()
//   in:  nothing
//   out: RecordingAudioPayload — mime_type + audio_base64 of the recorded audio
//   - iOS only: stops the recorder, reads the file, returns as base64, cleans up
//
// Key assumptions for any implementation:
//   - Audio files are stored in a hidden Recordings/ folder, separate from notes
//   - Each recording note links to its audio file via front-matter
//   - Transcription is queue-based with a background worker thread
//   - Only one transcription runs at a time (sequential processing)
//   - Status lifecycle: pending → queued → processing → completed | failed
//   - Two transcription backends: local whisper (python subprocess) and AssemblyAI (REST API)
