use type_core::{
    application::recordings::RecordingsUseCases, ensure_security_unlocked_for_app,
    CheckWhisperStatusArgs, NativeRecorderCapabilities, QueueLocalTranscriptionsArgs,
    QueueRecordingsArgs, ReadRecordingAudioArgs, RecordingAudioPayload,
    RecordingTranscriptionQueueResult, RecordingWriteResult, RecordingsListResult,
    RetriggerTranscriptionArgs, SaveRecordingArgs, WhisperStatusResult,
};

use crate::TauriRecordingsAdapter;

fn recordings_use_cases(
    app: tauri::AppHandle,
) -> Result<RecordingsUseCases<TauriRecordingsAdapter>, String> {
    Ok(RecordingsUseCases::new(TauriRecordingsAdapter::new(
        crate::app_env(&app)?,
    )))
}

#[tauri::command]
pub(super) fn native_audio_recorder_capabilities(
    app: tauri::AppHandle,
) -> Result<NativeRecorderCapabilities, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    recordings_use_cases(app)?.native_capabilities()
}

#[tauri::command]
pub(super) fn start_native_audio_recording(app: tauri::AppHandle) -> Result<(), String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    recordings_use_cases(app)?.start_native()
}

#[tauri::command]
pub(super) fn stop_native_audio_recording(
    app: tauri::AppHandle,
) -> Result<RecordingAudioPayload, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    recordings_use_cases(app)?.stop_native()
}

#[tauri::command]
pub(super) fn save_audio_recording(
    app: tauri::AppHandle,
    args: SaveRecordingArgs,
) -> Result<RecordingWriteResult, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    recordings_use_cases(app)?.save(args)
}

#[tauri::command]
pub(super) fn queue_recording_transcriptions(
    app: tauri::AppHandle,
    args: QueueRecordingsArgs,
) -> Result<RecordingTranscriptionQueueResult, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    recordings_use_cases(app)?.queue_cloud(args)
}

#[tauri::command]
pub(super) fn queue_local_transcriptions(
    app: tauri::AppHandle,
    args: QueueLocalTranscriptionsArgs,
) -> Result<RecordingTranscriptionQueueResult, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    recordings_use_cases(app)?.queue_local(args)
}

#[tauri::command]
pub(super) fn retrigger_transcription(
    app: tauri::AppHandle,
    args: RetriggerTranscriptionArgs,
) -> Result<(), String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    recordings_use_cases(app)?.retrigger(args)
}

#[tauri::command]
pub(super) fn check_whisper_status(
    app: tauri::AppHandle,
    args: CheckWhisperStatusArgs,
) -> WhisperStatusResult {
    match recordings_use_cases(app) {
        Ok(use_cases) => use_cases.whisper_status(args),
        Err(error) => WhisperStatusResult {
            available: false,
            python_found: false,
            error: Some(error),
        },
    }
}

#[tauri::command]
pub(super) fn list_recordings(app: tauri::AppHandle) -> Result<RecordingsListResult, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    recordings_use_cases(app)?.list()
}

#[tauri::command]
pub(super) fn read_recording_audio(
    app: tauri::AppHandle,
    args: ReadRecordingAudioArgs,
) -> Result<RecordingAudioPayload, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    recordings_use_cases(app)?.read_audio(args)
}
