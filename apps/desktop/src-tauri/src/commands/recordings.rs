use type_core::{
    application::recordings::RecordingsUseCases, ensure_security_unlocked_for_app,
    AudioImportState, CheckWhisperStatusArgs, ImportAudioFilesArgs, QueueLocalTranscriptionsArgs,
    QueueRecordingsArgs, ReadRecordingAudioArgs, RecordingAudioPayload,
    RecordingTranscriptionQueueResult, RecordingWriteResult, RecordingsAdapter,
    RecordingsListResult, RetriggerTranscriptionArgs, SaveRecordingArgs, WhisperStatusResult,
};

fn recordings_use_cases(
    app: tauri::AppHandle,
) -> Result<RecordingsUseCases<RecordingsAdapter>, String> {
    Ok(RecordingsUseCases::new(RecordingsAdapter::new(
        crate::app_env(&app)?,
    )))
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

/// Resolve a note's root-relative `recording_audio_path` to an absolute path
/// so the frontend can hand it to Tauri's asset protocol (`convertFileSrc`)
/// and let the `<audio>` element stream it directly from disk, instead of
/// round-tripping the whole file through IPC as base64.
#[tauri::command]
pub(super) fn resolve_recording_audio_path(
    app: tauri::AppHandle,
    args: ReadRecordingAudioArgs,
) -> Result<String, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    RecordingsAdapter::new(crate::app_env(&app)?).resolve_audio_absolute_path(&args.path)
}

/// Import existing audio files (e.g. Voice Memos already on disk) as
/// recording notes, one per file, preserving each source file's real
/// creation date. Runs on a background worker thread; poll progress via
/// `audio_import_status`.
#[tauri::command]
pub(super) fn import_audio_files(
    app: tauri::AppHandle,
    args: ImportAudioFilesArgs,
) -> Result<(), String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    RecordingsAdapter::new(crate::app_env(&app)?).import_audio_files(args)
}

#[tauri::command]
pub(super) fn audio_import_status(app: tauri::AppHandle) -> Result<AudioImportState, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    Ok(RecordingsAdapter::new(crate::app_env(&app)?).audio_import_status())
}
