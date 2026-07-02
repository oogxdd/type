//! Recording save + transcription queue, mirroring the desktop
//! `commands/recordings.rs` surface. Native capture and local Whisper stay in
//! their shells — a React Native host records via its own audio module and
//! calls `save_audio_recording`, then either queues AssemblyAI, queues its own
//! [`TranscriptionProvider`], or leaves recordings `pending` for a desktop to
//! transcribe after git sync (`transcription_mode: "desktop"`).

use std::sync::Arc;

use type_core::{
    application::recordings::RecordingsUseCases, queue_recordings_for_provider_transcription,
    QueueRecordingsArgs, ReadRecordingAudioArgs, RecordingsAdapter, SaveRecordingArgs,
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
#[uniffi::export(with_foreign)]
pub trait TranscriptionProvider: Send + Sync {
    /// Stable identifier used in error messages, e.g. "apple-speech".
    fn id(&self) -> String;
    /// Transcribe the audio file at `audio_path` (absolute) and return the
    /// transcript text.
    fn transcribe(&self, audio_path: String) -> Result<String, CoreError>;
}

/// Bridges the FFI trait onto the core port so queued jobs can call back into
/// the host implementation.
struct ForeignTranscriptionProvider(Arc<dyn TranscriptionProvider>);

impl type_core::ports::recordings::TranscriptionProvider for ForeignTranscriptionProvider {
    fn id(&self) -> String {
        self.0.id()
    }

    fn transcribe(&self, audio_path: &std::path::Path) -> Result<String, String> {
        self.0
            .transcribe(audio_path.to_string_lossy().into_owned())
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
        to_json(&queue_recordings_for_provider_transcription(&root, bridged)?)
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
