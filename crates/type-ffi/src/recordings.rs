//! Recording save + transcription queue, mirroring the desktop
//! `commands/recordings.rs` surface. Native capture and local Whisper stay in
//! their shells — a React Native host records via its own audio module and
//! calls `save_audio_recording`, then either queues AssemblyAI, queues its own
//! [`TranscriptionProvider`], or leaves recordings `pending` for a desktop to
//! transcribe after git sync (`transcription_mode: "desktop"`).

use std::sync::Arc;

use type_core::{
    application::recordings::RecordingsUseCases, queue_recordings_for_provider_transcription,
    ImportAudioFilesArgs, QueueRecordingsArgs, ReadRecordingAudioArgs, RecordingsAdapter,
    SaveRecordingArgs,
};

use crate::{from_json, run_blocking, to_json, unlocked_env, CoreError};

fn recordings_use_cases() -> Result<RecordingsUseCases<RecordingsAdapter>, String> {
    Ok(RecordingsUseCases::new(RecordingsAdapter::new(
        unlocked_env()?,
    )))
}

/// A transcription backend implemented by the host (Swift/Kotlin/JS) — e.g.
/// native on-device speech recognition. Methods are called from the queue's
/// Rust worker thread, one job at a time.
///
/// `transcribe` is `async` because host recognizers are inherently
/// event-driven (a JS `Promise`, iOS `SFSpeechRecognizer` callbacks). The
/// core's transcription port is synchronous and its worker is a plain thread,
/// so [`ForeignTranscriptionProvider`] blocks on this future — the worker
/// already runs one job at a time, so blocking it is the intended behavior.
#[uniffi::export(with_foreign)]
#[async_trait::async_trait]
pub trait TranscriptionProvider: Send + Sync {
    /// Stable identifier used in error messages, e.g. "apple-speech".
    fn id(&self) -> String;
    /// Transcribe the audio file at `audio_path` (absolute) and return the
    /// transcript text.
    async fn transcribe(&self, audio_path: String) -> Result<String, CoreError>;
}

/// Bridges the FFI trait onto the core port so queued jobs can call back into
/// the host implementation.
struct ForeignTranscriptionProvider(Arc<dyn TranscriptionProvider>);

impl type_core::ports::recordings::TranscriptionProvider for ForeignTranscriptionProvider {
    fn id(&self) -> String {
        self.0.id()
    }

    fn transcribe(&self, audio_path: &std::path::Path) -> Result<String, String> {
        let provider = Arc::clone(&self.0);
        let audio_path = audio_path.to_string_lossy().into_owned();
        // The core worker thread is synchronous and not inside a Tokio
        // runtime, so spin up a current-thread runtime to drive the host's
        // async recognizer to completion. The queue processes one job at a
        // time, so parking this thread here is fine.
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| format!("failed to start transcription runtime: {error}"))?;
        runtime
            .block_on(provider.transcribe(audio_path))
            .map_err(|error| error.to_string())
    }
}

/// `args_json`: `SaveRecordingArgs` (`audio_base64`, optional `mime_type` /
/// `folder_path` / `file_name_format`). Returns JSON `RecordingWriteResult`.
/// The new note starts with `transcription_status: pending`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn save_audio_recording(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: SaveRecordingArgs = from_json(&args_json)?;
        to_json(&recordings_use_cases()?.save(args)?)
    })
    .await
}

/// Queue every pending/failed recording for AssemblyAI. `args_json`:
/// `QueueRecordingsArgs` (optional `assembly_api_key`, falling back to the
/// device app config). Returns JSON `RecordingTranscriptionQueueResult`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn queue_recording_transcriptions(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: QueueRecordingsArgs = from_json(&args_json)?;
        to_json(&recordings_use_cases()?.queue_cloud(args)?)
    })
    .await
}

/// Queue every pending/failed recording against a host-supplied
/// [`TranscriptionProvider`]. Returns JSON `RecordingTranscriptionQueueResult`;
/// jobs then run on the shared background worker.
#[uniffi::export(async_runtime = "tokio")]
pub async fn queue_provider_transcriptions(
    provider: Arc<dyn TranscriptionProvider>,
) -> Result<String, CoreError> {
    run_blocking(move || {
        let root = type_core::ensured_notes_root(&unlocked_env()?)?;
        let bridged: Arc<dyn type_core::ports::recordings::TranscriptionProvider> =
            Arc::new(ForeignTranscriptionProvider(provider));
        to_json(&queue_recordings_for_provider_transcription(
            &root, bridged,
        )?)
    })
    .await
}

/// Queue snapshot + all recording notes as JSON (`RecordingsListResult`).
#[uniffi::export(async_runtime = "tokio")]
pub async fn list_recordings() -> Result<String, CoreError> {
    run_blocking(|| to_json(&recordings_use_cases()?.list()?)).await
}

/// Audio bytes for a recording as JSON (`RecordingAudioPayload`), path must be
/// inside the `Recordings/` storage folder.
#[uniffi::export(async_runtime = "tokio")]
pub async fn read_recording_audio(path: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args = ReadRecordingAudioArgs { path };
        to_json(&recordings_use_cases()?.read_audio(args)?)
    })
    .await
}

/// Import audio files that already exist on disk (a Voice Memo shared into the
/// app, files picked from Files) as recording notes — one note per file,
/// `transcription_status: pending`, each keeping the source file's own creation
/// date rather than "now".
///
/// `args_json`: `ImportAudioFilesArgs` (`source_paths` — **absolute** paths, not
/// `file://` URLs — plus optional `target_folder` / `file_name_format`).
///
/// Returns as soon as the background worker starts; poll
/// [`audio_import_status`] for progress. Unlike `save_audio_recording`, the
/// bytes never cross the FFI boundary — the core copies each file itself, which
/// is what makes hour-long memos practical on a phone.
#[uniffi::export(async_runtime = "tokio")]
pub async fn import_audio_files(args_json: String) -> Result<(), CoreError> {
    run_blocking(move || {
        let args: ImportAudioFilesArgs = from_json(&args_json)?;
        RecordingsAdapter::new(unlocked_env()?).import_audio_files(args)
    })
    .await
}

/// Progress of the current/last [`import_audio_files`] run as JSON
/// (`AudioImportState`).
#[uniffi::export(async_runtime = "tokio")]
pub async fn audio_import_status() -> Result<String, CoreError> {
    run_blocking(|| to_json(&RecordingsAdapter::new(unlocked_env()?).audio_import_status())).await
}
