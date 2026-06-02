use crate::*;

#[tauri::command]
pub(super) fn native_audio_recorder_capabilities(
    app: tauri::AppHandle,
) -> Result<NativeRecorderCapabilities, String> {
    ensure_security_unlocked_for_app(&app)?;
    #[cfg(target_os = "ios")]
    {
        let (recording, started_ms) = ios_native_recorder_state()
            .lock()
            .map(|guard| {
                let Some(state) = guard.as_ref() else {
                    return (false, None);
                };
                let recorder = state.recorder_ptr as *mut Object;
                let resumed = ios_ensure_recorder_active(recorder);
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

#[tauri::command]
pub(super) fn start_native_audio_recording(app: tauri::AppHandle) -> Result<(), String> {
    ensure_security_unlocked_for_app(&app)?;
    #[cfg(target_os = "ios")]
    {
        let mut guard = ios_native_recorder_state()
            .lock()
            .map_err(|_| "Native recorder state lock poisoned.".to_string())?;
        if guard.is_some() {
            return Err("Native audio recorder is already active.".to_string());
        }
        let output_path = next_native_recording_path(&app)?;
        ensure_avfoundation_loaded()?;
        configure_ios_audio_for_recording()?;
        let recorder = create_ios_audio_recorder(&output_path).inspect_err(|_| {
            deactivate_ios_audio();
        })?;

        *guard = Some(IosNativeRecorderState {
            recorder_ptr: recorder as usize,
            output_path,
            mime_type: IOS_AUDIO_MIME_TYPE.to_string(),
            started_ms: now_ms(),
        });
        Ok(())
    }

    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Err("Native iOS audio recorder is unavailable on this platform.".to_string())
    }
}

#[tauri::command]
pub(super) fn stop_native_audio_recording(
    app: tauri::AppHandle,
) -> Result<RecordingAudioPayload, String> {
    ensure_security_unlocked_for_app(&app)?;
    #[cfg(target_os = "ios")]
    {
        let state = {
            let mut guard = ios_native_recorder_state()
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
        deactivate_ios_audio();

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

#[tauri::command]
pub(super) fn save_audio_recording(
    app: tauri::AppHandle,
    args: SaveRecordingArgs,
) -> Result<RecordingWriteResult, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    let audio_bytes = decode_audio_base64(&args.audio_base64)?;
    if audio_bytes.is_empty() {
        return Err("Audio payload is empty.".to_string());
    }

    let (target_folder_rel, target_folder_path) =
        resolve_recording_target_folder(&app, args.folder_path.as_deref())?;
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
    if !is_feed_folder_path(&root, &target_folder_path) {
        update_order_append(&target_folder_path, &[note_file_name], false)?;
    }

    Ok(RecordingWriteResult {
        folder_path: target_folder_rel,
        note_path: strip_root(&root, &note_path),
        audio_path: strip_root(&root, &audio_path),
    })
}

#[tauri::command]
pub(super) fn queue_recording_transcriptions(
    app: tauri::AppHandle,
    args: QueueRecordingsArgs,
) -> Result<RecordingTranscriptionQueueResult, String> {
    ensure_security_unlocked_for_app(&app)?;
    let api_key = args.assembly_api_key.trim();
    if api_key.is_empty() {
        return Err("AssemblyAI API key is required.".to_string());
    }

    let root = ensured_notes_root(&app)?;
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
            RECORDING_STATUS_QUEUED | RECORDING_STATUS_PROCESSING
        ) && is_active_recording
        {
            skipped += 1;
            continue;
        }

        update_recording_note_status(
            &recording.note_path,
            RECORDING_STATUS_QUEUED,
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

#[tauri::command]
pub(super) fn queue_local_transcriptions(
    app: tauri::AppHandle,
    args: QueueLocalTranscriptionsArgs,
) -> Result<RecordingTranscriptionQueueResult, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    let model = if args.model.trim().is_empty() {
        DEFAULT_WHISPER_MODEL.to_string()
    } else {
        args.model.trim().to_string()
    };
    queue_recordings_for_local_transcription(&root, &model)
}

#[tauri::command]
pub(super) fn retrigger_transcription(
    app: tauri::AppHandle,
    args: RetriggerTranscriptionArgs,
) -> Result<(), String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    let note_rel = args.note_path.trim();
    if note_rel.is_empty() {
        return Err("Note path is required.".to_string());
    }
    let model = args.model.as_deref().unwrap_or(DEFAULT_WHISPER_MODEL);
    retrigger_single_transcription(&root, note_rel, model)
}

#[tauri::command]
pub(super) fn check_whisper_status(args: CheckWhisperStatusArgs) -> WhisperStatusResult {
    check_whisper_availability(args.model.as_deref())
}

#[tauri::command]
pub(super) fn list_recordings(app: tauri::AppHandle) -> Result<RecordingsListResult, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
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

#[tauri::command]
pub(super) fn read_recording_audio(
    app: tauri::AppHandle,
    args: ReadRecordingAudioArgs,
) -> Result<RecordingAudioPayload, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
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
