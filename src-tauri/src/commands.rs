use super::*;

#[tauri::command]
fn get_security_state(app: tauri::AppHandle) -> Result<SecurityState, String> {
    get_security_state_impl(&app)
}

#[tauri::command]
fn enable_security(
    app: tauri::AppHandle,
    args: EnableSecurityArgs,
) -> Result<SecurityState, String> {
    enable_security_impl(&app, args)
}

#[tauri::command]
fn lock_security(app: tauri::AppHandle) -> Result<SecurityState, String> {
    lock_security_impl(&app)
}

#[tauri::command]
fn unlock_security(
    app: tauri::AppHandle,
    args: UnlockSecurityArgs,
) -> Result<SecurityUnlockResult, String> {
    unlock_security_impl(&app, args)
}

#[tauri::command]
fn set_security_preferences(
    app: tauri::AppHandle,
    args: SetSecurityPreferencesArgs,
) -> Result<SecurityState, String> {
    set_security_preferences_impl(&app, args)
}

#[tauri::command]
fn get_profiles(app: tauri::AppHandle) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&app)?;
    let state = ensure_profiles_state(&app).or_else(|_| default_profiles_state(&app))?;
    Ok(profiles_snapshot(&state))
}

#[tauri::command]
fn create_profile(
    app: tauri::AppHandle,
    args: CreateProfileArgs,
) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&app)?;
    let state = create_profile_state(&app, &args.name, args.description.as_deref())?;
    Ok(profiles_snapshot(&state))
}

#[tauri::command]
fn set_active_profile(
    app: tauri::AppHandle,
    args: SetActiveProfileArgs,
) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&app)?;
    let state = set_active_profile_state(&app, &args.profile_id)?;
    Ok(profiles_snapshot(&state))
}

#[tauri::command]
fn set_profile_notes_root(
    app: tauri::AppHandle,
    args: SetProfileNotesRootArgs,
) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&app)?;
    let state = set_profile_notes_root_state(&app, &args.profile_id, &args.notes_root)?;
    Ok(profiles_snapshot(&state))
}

#[tauri::command]
fn update_profile(
    app: tauri::AppHandle,
    args: UpdateProfileArgs,
) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&app)?;
    let state = update_profile_state(
        &app,
        &args.profile_id,
        args.name.as_deref(),
        args.description.as_deref(),
    )?;
    Ok(profiles_snapshot(&state))
}

#[tauri::command]
fn delete_profile(
    app: tauri::AppHandle,
    args: DeleteProfileArgs,
) -> Result<NotesProfilesSnapshot, String> {
    ensure_security_unlocked_for_app(&app)?;
    let state = delete_profile_state(&app, &args.profile_id)?;
    Ok(profiles_snapshot(&state))
}

#[tauri::command]
async fn create_profiles_backup_zip(
    app: tauri::AppHandle,
) -> Result<ProfilesBackupArchive, String> {
    ensure_security_unlocked_for_app(&app)?;
    run_blocking_command(move || create_profiles_backup_zip_impl(&app)).await
}

#[tauri::command]
fn present_file_export_sheet(app: tauri::AppHandle, path: String) -> Result<(), String> {
    ensure_security_unlocked_for_app(&app)?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Export file path is required.".to_string());
    }

    #[cfg(target_os = "ios")]
    {
        let export_path = PathBuf::from(trimmed);
        return present_ios_file_export_sheet(&app, &export_path);
    }

    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Err("Native iOS file export is unavailable on this platform.".to_string())
    }
}

async fn run_blocking_command<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_git_status(app: tauri::AppHandle) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    run_blocking_command(move || get_git_status_blocking(app)).await
}

#[tauri::command]
async fn get_git_history(
    app: tauri::AppHandle,
    args: Option<GitHistoryArgs>,
) -> Result<Vec<GitCommitHistoryEntry>, String> {
    ensure_security_unlocked_for_app(&app)?;
    run_blocking_command(move || {
        ensure_security_unlocked_for_app(&app)?;
        let root = ensured_notes_root(&app)?;
        let limit = args.and_then(|value| value.limit).unwrap_or(40);
        build_git_history(&root, limit)
    })
    .await
}

fn get_git_status_blocking(app: tauri::AppHandle) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    Ok(build_git_status(&root))
}

#[tauri::command]
async fn connect_git_repo(
    app: tauri::AppHandle,
    args: ConnectGitArgs,
) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    run_blocking_command(move || connect_git_repo_blocking(app, args)).await
}

fn connect_git_repo_blocking(
    app: tauri::AppHandle,
    args: ConnectGitArgs,
) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    let repo = ensure_git_repo(&root)?;
    prepare_bootstrap_worktree_for_sync(&root, &repo)?;
    ensure_origin_remote(&repo, &args.remote_url)?;
    let target_branch = resolve_target_branch(&repo, args.branch.clone());
    switch_or_prepare_branch(&repo, &target_branch)?;
    let fetched = match perform_fetch(
        &repo,
        &target_branch,
        args.username.as_deref(),
        args.password.as_deref(),
    ) {
        Ok(commit) => Some(commit),
        Err(error) => {
            let lower = error.to_lowercase();
            if lower.contains("couldn't find remote ref") {
                None
            } else {
                return Err(error);
            }
        }
    };
    if let Some(fetched_commit) = fetched {
        let analysis = repo
            .merge_analysis(&[&fetched_commit])
            .map_err(map_git_error)?
            .0;
        if analysis.is_fast_forward() || analysis.is_up_to_date() {
            fast_forward_to(&repo, &target_branch, &fetched_commit)?;
        }
    }
    Ok(build_git_status(&root))
}

#[tauri::command]
async fn git_pull(app: tauri::AppHandle, args: GitSyncArgs) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    run_blocking_command(move || git_pull_blocking(app, args)).await
}

fn git_pull_blocking(app: tauri::AppHandle, args: GitSyncArgs) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    if !git_repo_initialized(&root) {
        return Err("Repository is not initialized. Connect a remote first.".to_string());
    }
    let repo = open_repo(&root)?;
    prepare_bootstrap_worktree_for_sync(&root, &repo)?;
    if git_has_changes(&repo) {
        return Err("Local changes detected. Push or commit before pulling.".to_string());
    }
    let target_branch = resolve_target_branch(&repo, args.branch.clone());
    switch_or_prepare_branch(&repo, &target_branch)?;
    let fetched = perform_fetch(
        &repo,
        &target_branch,
        args.username.as_deref(),
        args.password.as_deref(),
    )?;
    let (analysis, _) = repo.merge_analysis(&[&fetched]).map_err(map_git_error)?;
    if analysis.is_up_to_date() {
        return Ok(build_git_status(&root));
    }
    if analysis.is_fast_forward() {
        fast_forward_to(&repo, &target_branch, &fetched)?;
        return Ok(build_git_status(&root));
    }
    if analysis.is_normal() {
        merge_fetched_commit(&repo, &target_branch, &fetched)?;
        return Ok(build_git_status(&root));
    }
    Err("Pull failed because local and remote history could not be merged.".to_string())
}

fn remote_push(
    repo: &Repository,
    branch: &str,
    username: Option<&str>,
    password: Option<&str>,
) -> Result<(), String> {
    let callbacks = build_callbacks(username, password);
    let mut push_options = PushOptions::new();
    push_options.remote_callbacks(callbacks);
    let mut remote = repo.find_remote("origin").map_err(map_git_error)?;
    remote
        .connect_auth(
            Direction::Push,
            Some(build_callbacks(username, password)),
            None,
        )
        .map_err(map_git_error)?;
    remote
        .push(
            &[&format!("refs/heads/{0}:refs/heads/{0}", branch)],
            Some(&mut push_options),
        )
        .map_err(map_git_error)?;
    let mut local = repo
        .find_branch(branch, git2::BranchType::Local)
        .map_err(map_git_error)?;
    local
        .set_upstream(Some(&format!("origin/{}", branch)))
        .map_err(map_git_error)?;
    Ok(())
}

#[tauri::command]
async fn git_push(app: tauri::AppHandle, args: GitPushArgs) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    run_blocking_command(move || git_push_blocking(app, args)).await
}

fn git_push_blocking(app: tauri::AppHandle, args: GitPushArgs) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    if !git_repo_initialized(&root) {
        return Err("Repository is not initialized. Connect a remote first.".to_string());
    }
    let repo = open_repo(&root)?;
    let target_branch = resolve_target_branch(&repo, args.branch.clone());
    switch_or_prepare_branch(&repo, &target_branch)?;
    let message = args
        .message
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("Sync notes");
    let status_before_push = build_git_status(&root);
    if !status_before_push.push_required {
        return Ok(status_before_push);
    }
    let _ = commit_all_changes(&repo, message, &target_branch)?;
    remote_push(
        &repo,
        &target_branch,
        args.username.as_deref(),
        args.password.as_deref(),
    )?;
    Ok(build_git_status(&root))
}

#[tauri::command]
fn get_tree(app: tauri::AppHandle) -> Result<FolderNode, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    build_folder_node(&root, "")
}

#[tauri::command]
fn read_note(app: tauri::AppHandle, path: String) -> Result<String, String> {
    ensure_security_unlocked_for_app(&app)?;
    let full_path = resolve_path(&app, &path)?;
    if !full_path.exists() || !full_path.is_file() {
        return Err("Note file does not exist.".to_string());
    }
    let raw = fs::read_to_string(full_path).map_err(|err| err.to_string())?;
    let (_, body) = parse_note_front_matter(&raw);
    decrypt_note_body_for_read(&body)
}

#[tauri::command]
fn create_note(app: tauri::AppHandle, args: CreateNoteArgs) -> Result<CreateNoteResult, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    let folder_rel = args
        .folder_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(FEED_FOLDER);
    let folder_full = resolve_path(&app, folder_rel)?;
    if is_storage_folder_path(&root, &folder_full) {
        return Err(
            "Notes cannot be created inside recordings or attachments storage.".to_string(),
        );
    }
    fs::create_dir_all(&folder_full).map_err(|err| err.to_string())?;

    let timestamp = args.timestamp_ms.or_else(now_ms).unwrap_or(0);
    let content = args.content.unwrap_or_default();
    let note_id = generate_note_id();
    let fallback = format!("note-{}", uuid_tail_without_timestamp_prefix(&note_id));
    let file_name = allocate_note_file_name(
        &folder_full,
        timestamp,
        &note_id,
        &content,
        &fallback,
        args.file_name_format,
    )?;
    let path = folder_full.join(&file_name);
    let mut meta = NoteFrontMatter::default();
    meta.id = Some(note_id);
    meta.created_ms = Some(timestamp);
    meta.updated_ms = Some(timestamp);
    write_note_with_front_matter(&path, &meta, &content)?;
    if !is_feed_folder_path(&root, &folder_full) {
        update_order_append(&folder_full, &[file_name], false)?;
    }

    Ok(CreateNoteResult {
        path: strip_root(&root, &path),
    })
}

#[tauri::command]
fn write_note(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    ensure_security_unlocked_for_app(&app)?;
    let full_path = resolve_path(&app, &path)?;
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let mut meta = if full_path.exists() {
        let existing = fs::read_to_string(&full_path).map_err(|err| err.to_string())?;
        let (parsed, _) = parse_note_front_matter(&existing);
        parsed
    } else {
        NoteFrontMatter::default()
    };
    if meta.id.is_none() {
        meta.id = Some(generate_note_id());
    }
    let now = now_ms();
    if meta.created_ms.is_none() {
        meta.created_ms = now;
    }
    meta.updated_ms = now.or(meta.updated_ms);
    write_note_with_front_matter(&full_path, &meta, &content)
}

#[tauri::command]
fn set_note_timestamp(app: tauri::AppHandle, args: SetNoteTimestampArgs) -> Result<(), String> {
    ensure_security_unlocked_for_app(&app)?;
    let full_path = resolve_path(&app, &args.path)?;
    if !full_path.exists() || !full_path.is_file() {
        return Err("Note file does not exist.".to_string());
    }
    let raw = fs::read_to_string(&full_path).map_err(|err| err.to_string())?;
    let (mut meta, body) = parse_note_front_matter(&raw);
    let body = decrypt_note_body_for_read(&body)?;
    if meta.id.is_none() {
        meta.id = Some(generate_note_id());
    }
    if meta.created_ms.is_none() || meta.created_ms.unwrap_or(i64::MAX) > args.timestamp_ms {
        meta.created_ms = Some(args.timestamp_ms);
    }
    meta.updated_ms = Some(args.timestamp_ms);
    write_note_with_front_matter(&full_path, &meta, &body)
}

#[tauri::command]
fn native_audio_recorder_capabilities(
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
fn start_native_audio_recording(app: tauri::AppHandle) -> Result<(), String> {
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
fn stop_native_audio_recording(app: tauri::AppHandle) -> Result<RecordingAudioPayload, String> {
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
fn save_audio_recording(
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
fn save_handwriting_attachment(
    app: tauri::AppHandle,
    args: SaveHandwritingAttachmentArgs,
) -> Result<HandwritingAttachmentWriteResult, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    let image_bytes = decode_image_base64(&args.image_base64)?;
    if image_bytes.is_empty() {
        return Err("Image payload is empty.".to_string());
    }

    let extension =
        supported_image_extension(args.mime_type.as_deref(), args.file_name.as_deref())?;
    let (target_folder_rel, target_folder_path) =
        resolve_handwriting_target_folder(&app, args.folder_path.as_deref())?;
    let attachment_path = handwriting_attachment_file_path(&root, extension)?;
    fs::write(&attachment_path, image_bytes).map_err(|error| error.to_string())?;

    let now = now_ms().unwrap_or(0);
    let note_id = generate_note_id();
    let note_file_name =
        handwriting_note_file_name(&target_folder_path, now, &note_id, args.file_name_format)?;
    let note_path = target_folder_path.join(&note_file_name);
    let mut meta = NoteFrontMatter::default();
    meta.id = Some(note_id);
    meta.created_ms = Some(now);
    meta.updated_ms = Some(now);
    meta.note_type = Some(HANDWRITING_FRONTMATTER_TYPE.to_string());
    meta.handwriting_attachment_path = Some(strip_root(&root, &attachment_path));
    meta.ocr_status = Some(RECORDING_STATUS_PENDING.to_string());
    meta.ocr_error = None;
    meta.ocr_updated_ms = Some(now);

    write_note_with_front_matter(&note_path, &meta, &handwriting_initial_body())?;
    if !is_feed_folder_path(&root, &target_folder_path) {
        update_order_append(&target_folder_path, &[note_file_name], false)?;
    }

    Ok(HandwritingAttachmentWriteResult {
        folder_path: target_folder_rel,
        note_path: strip_root(&root, &note_path),
        attachment_path: strip_root(&root, &attachment_path),
    })
}

#[tauri::command]
fn queue_recording_transcriptions(
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
            api_key: api_key.to_string(),
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
fn queue_handwriting_ocr(
    app: tauri::AppHandle,
    args: QueueHandwritingOcrArgs,
) -> Result<HandwritingOcrQueueResult, String> {
    ensure_security_unlocked_for_app(&app)?;
    let provider = parse_handwriting_ocr_provider(&args.provider)?;
    let api_key = args.api_key.trim();
    if api_key.is_empty() {
        return Err("OCR API key is required.".to_string());
    }
    let model = args.model.trim();
    if model.is_empty() {
        return Err("OCR model is required.".to_string());
    }

    let root = ensured_notes_root(&app)?;
    let notes = collect_handwriting_notes(&root)?;
    let active_notes = active_handwriting_note_paths();
    let mut scanned = 0usize;
    let mut skipped = 0usize;
    let mut candidates = Vec::new();

    for note in notes {
        scanned += 1;
        if !note.attachment_path.exists() {
            let _ = update_handwriting_note_status(
                &note.note_path,
                RECORDING_STATUS_FAILED,
                Some("Attachment file is missing.".to_string()),
                None,
            );
            skipped += 1;
            continue;
        }

        let status = note.status.as_str();
        let is_active = active_notes.contains(&note.note_rel);
        if status == RECORDING_STATUS_COMPLETED {
            skipped += 1;
            continue;
        }
        if matches!(
            status,
            RECORDING_STATUS_QUEUED | RECORDING_STATUS_PROCESSING
        ) && is_active
        {
            skipped += 1;
            continue;
        }

        update_handwriting_note_status(&note.note_path, RECORDING_STATUS_QUEUED, None, None)?;
        candidates.push(QueuedHandwritingOcrJob {
            note_rel: note.note_rel,
            note_path: note.note_path,
            attachment_path: note.attachment_path,
            provider,
            api_key: api_key.to_string(),
            model: model.to_string(),
        });
    }

    let queued = {
        let queue = handwriting_ocr_queue_state();
        let mut state = queue.lock().expect("handwriting ocr queue poisoned");
        let mut added = 0usize;
        for job in candidates {
            if state.known_notes.contains(&job.note_rel) {
                continue;
            }
            state.known_notes.insert(job.note_rel.clone());
            state.pending.push_back(job);
            added += 1;
        }
        added
    };

    spawn_handwriting_ocr_worker_if_needed();

    let in_flight = handwriting_queue_snapshot().in_flight;

    Ok(HandwritingOcrQueueResult {
        scanned,
        queued,
        skipped,
        in_flight,
    })
}

#[tauri::command]
fn list_recordings(app: tauri::AppHandle) -> Result<RecordingsListResult, String> {
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
fn list_handwriting_ocr_jobs(app: tauri::AppHandle) -> Result<HandwritingOcrListResult, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    let queue = handwriting_queue_snapshot();
    let pending_set = queue
        .pending
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();

    let mut jobs = collect_handwriting_notes(&root)?
        .into_iter()
        .map(|note| {
            let folder_path = note_parent_folder_path(&note.note_rel);
            let attachment_exists = note.attachment_path.exists();
            let mut error = note.error.clone();
            if !attachment_exists {
                error = Some("Attachment file is missing.".to_string());
            }
            HandwritingOcrListItem {
                note_path: note.note_rel.clone(),
                folder_path,
                attachment_path: if attachment_exists {
                    Some(note.attachment_rel.clone())
                } else {
                    None
                },
                status: note.status.clone(),
                error,
                updated_ms: note.updated_ms,
                is_queued: pending_set.contains(note.note_rel.as_str()),
                is_processing: queue.current_note.as_deref() == Some(note.note_rel.as_str()),
            }
        })
        .collect::<Vec<_>>();

    jobs.sort_by(|a, b| b.updated_ms.unwrap_or(0).cmp(&a.updated_ms.unwrap_or(0)));

    Ok(HandwritingOcrListResult { queue, jobs })
}

#[tauri::command]
fn read_recording_audio(
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

#[tauri::command]
fn get_note_meta(app: tauri::AppHandle, path: String) -> Result<NoteMeta, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = notes_root(&app)?;
    let full_path = resolve_path(&app, &path)?;
    let (front_matter_meta, metadata) = if full_path.exists() {
        let raw = fs::read_to_string(&full_path).map_err(|err| err.to_string())?;
        let (front_matter_meta, _) = parse_note_front_matter(&raw);
        (
            front_matter_meta,
            fs::metadata(&full_path).map_err(|err| err.to_string())?,
        )
    } else {
        (
            NoteFrontMatter::default(),
            fs::metadata(&full_path).map_err(|err| err.to_string())?,
        )
    };
    let note_rel = strip_root(&root, &full_path);
    let (history_created_ms, history_updated_ms) =
        git_note_timestamps_from_history(&root, &note_rel).unwrap_or((None, None));

    let created_ms = front_matter_meta
        .created_ms
        .or(history_created_ms)
        .or_else(|| metadata.created().ok().and_then(time_to_ms));
    let updated_ms = front_matter_meta
        .updated_ms
        .or(history_updated_ms)
        .or_else(|| metadata.modified().ok().and_then(time_to_ms));
    Ok(NoteMeta {
        created_ms,
        updated_ms,
        note_type: front_matter_meta.note_type.clone(),
        recording_audio_path: front_matter_meta.recording_audio_path.clone(),
        handwriting_attachment_path: front_matter_meta.handwriting_attachment_path.clone(),
        transcription_status: front_matter_meta.transcription_status.clone(),
        transcription_error: front_matter_meta.transcription_error.clone(),
        transcription_updated_ms: front_matter_meta.transcription_updated_ms,
        ocr_status: front_matter_meta.ocr_status.clone(),
        ocr_error: front_matter_meta.ocr_error.clone(),
        ocr_updated_ms: front_matter_meta.ocr_updated_ms,
    })
}

#[tauri::command]
fn move_items(
    app: tauri::AppHandle,
    items: Vec<String>,
    destination: String,
) -> Result<(), String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    println!(
        "[move_items] root={} destination={}",
        root.to_string_lossy(),
        destination
    );
    let destination_path = resolve_path(&app, &destination)?;
    println!(
        "[move_items] destination_path={}",
        destination_path.to_string_lossy()
    );
    if !destination_path.exists() {
        return Err(format!(
            "Destination folder does not exist: {}",
            destination_path.to_string_lossy()
        ));
    }

    let mut source_groups_folders: HashMap<PathBuf, Vec<String>> = HashMap::new();
    let mut source_groups_notes: HashMap<PathBuf, Vec<String>> = HashMap::new();
    let mut moved_folder_names = Vec::new();
    let mut moved_note_names = Vec::new();

    for item in items {
        let source = resolve_path(&app, &item)?;
        if is_system_folder_path(&root, &source) {
            return Err(format!(
                "Cannot move system folder: {}",
                source.to_string_lossy()
            ));
        }
        if !source.exists() {
            return Err(format!(
                "Source does not exist: {}",
                source.to_string_lossy()
            ));
        }
        let meta = fs::metadata(&source).map_err(|err| {
            format!(
                "Failed to read metadata for {}: {}",
                source.to_string_lossy(),
                err
            )
        })?;
        let name = source
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| "Invalid item name.".to_string())?
            .to_string();
        let parent = source
            .parent()
            .ok_or_else(|| "Missing parent folder.".to_string())?
            .to_path_buf();

        let target = destination_path.join(&name);
        println!(
            "[move_items] move {} -> {}",
            source.to_string_lossy(),
            target.to_string_lossy()
        );
        fs::rename(&source, &target).map_err(|err| {
            format!(
                "Move failed {} -> {}: {}",
                source.to_string_lossy(),
                target.to_string_lossy(),
                err
            )
        })?;
        if meta.is_dir() {
            source_groups_folders
                .entry(parent)
                .or_default()
                .push(name.clone());
            moved_folder_names.push(name);
        } else {
            source_groups_notes
                .entry(parent)
                .or_default()
                .push(name.clone());
            moved_note_names.push(name);
        }
    }

    for (parent, names) in source_groups_folders {
        let rel = strip_root(&root, &parent);
        let parent_path = resolve_path(&app, &rel)?;
        update_order_remove(&parent_path, &names, true)?;
    }

    for (parent, names) in source_groups_notes {
        let rel = strip_root(&root, &parent);
        let parent_path = resolve_path(&app, &rel)?;
        update_order_remove(&parent_path, &names, false)?;
    }

    let dest_rel = strip_root(&root, &destination_path);
    let dest_full = resolve_path(&app, &dest_rel)?;
    println!(
        "[move_items] update order dest={} folders={} notes={}",
        dest_full.to_string_lossy(),
        moved_folder_names.len(),
        moved_note_names.len()
    );
    if !moved_folder_names.is_empty() {
        update_order_append(&dest_full, &moved_folder_names, true)?;
    }
    if !moved_note_names.is_empty() {
        update_order_append(&dest_full, &moved_note_names, false)?;
    }

    Ok(())
}

#[tauri::command]
fn delete_items(app: tauri::AppHandle, items: Vec<String>) -> Result<(), String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    let mut parent_folder_groups: HashMap<PathBuf, Vec<String>> = HashMap::new();
    let mut parent_note_groups: HashMap<PathBuf, Vec<String>> = HashMap::new();

    for item in items {
        let full_path = resolve_path(&app, &item)?;
        if is_system_folder_path(&root, &full_path) {
            return Err(format!(
                "Cannot delete system folder: {}",
                full_path.to_string_lossy()
            ));
        }
        let name = full_path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| "Invalid item name.".to_string())?
            .to_string();
        let parent = full_path
            .parent()
            .ok_or_else(|| "Missing parent folder.".to_string())?
            .to_path_buf();
        let meta = fs::metadata(&full_path).map_err(|err| err.to_string())?;
        if meta.is_dir() {
            fs::remove_dir_all(&full_path).map_err(|err| err.to_string())?;
            parent_folder_groups.entry(parent).or_default().push(name);
        } else {
            fs::remove_file(&full_path).map_err(|err| err.to_string())?;
            parent_note_groups.entry(parent).or_default().push(name);
        }
    }

    for (parent, names) in parent_folder_groups {
        let rel = strip_root(&root, &parent);
        let parent_path = resolve_path(&app, &rel)?;
        update_order_remove(&parent_path, &names, true)?;
    }

    for (parent, names) in parent_note_groups {
        let rel = strip_root(&root, &parent);
        let parent_path = resolve_path(&app, &rel)?;
        update_order_remove(&parent_path, &names, false)?;
    }

    Ok(())
}

#[tauri::command]
fn rename_item(app: tauri::AppHandle, path: String, new_name: String) -> Result<String, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    let full_path = resolve_path(&app, &path)?;
    if is_system_folder_path(&root, &full_path) {
        return Err(format!(
            "Cannot rename system folder: {}",
            full_path.to_string_lossy()
        ));
    }
    println!(
        "[rename_item] path={} new_name={}",
        full_path.to_string_lossy(),
        new_name
    );
    let parent = full_path
        .parent()
        .ok_or_else(|| "Missing parent folder.".to_string())?;
    let new_path = parent.join(&new_name);
    fs::rename(&full_path, &new_path).map_err(|err| err.to_string())?;
    let is_folder = new_path.is_dir();
    update_order_rename(
        parent,
        full_path.file_name().unwrap().to_str().unwrap(),
        &new_name,
        is_folder,
    )?;

    Ok(strip_root(&root, &new_path))
}

#[tauri::command]
fn set_order(app: tauri::AppHandle, args: SetOrderArgs) -> Result<(), String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    let parent_path = resolve_path(&app, &args.parent)?;
    if is_feed_folder_path(&root, &parent_path) {
        return Ok(());
    }
    println!(
        "[set_order] parent={} folder_order={} note_order={} parent_path={}",
        args.parent,
        args.folder_order.len(),
        args.note_order.len(),
        parent_path.to_string_lossy()
    );
    let order = OrderFile {
        folder_order: args.folder_order,
        note_order: args.note_order,
    };
    write_order_file(&parent_path, &order)
}

pub(super) fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_ota::init())
        .setup(|_app| {
            let app_handle = _app.handle();
            ensure_security_runtime_initialized_for_setup(&app_handle)?;
            #[cfg(target_os = "macos")]
            if let Some(window) = _app.get_webview_window("main") {
                let _ = apply_macos_window_alpha(&window, MACOS_WINDOW_ALPHA);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_security_state,
            enable_security,
            lock_security,
            unlock_security,
            set_security_preferences,
            get_tree,
            read_note,
            create_note,
            get_note_meta,
            write_note,
            set_note_timestamp,
            native_audio_recorder_capabilities,
            start_native_audio_recording,
            stop_native_audio_recording,
            save_audio_recording,
            save_handwriting_attachment,
            queue_recording_transcriptions,
            queue_handwriting_ocr,
            list_recordings,
            list_handwriting_ocr_jobs,
            read_recording_audio,
            move_items,
            delete_items,
            rename_item,
            set_order,
            get_profiles,
            create_profile,
            set_active_profile,
            set_profile_notes_root,
            update_profile,
            delete_profile,
            create_profiles_backup_zip,
            present_file_export_sheet,
            get_git_status,
            get_git_history,
            connect_git_repo,
            git_pull,
            git_push
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "ios")]
        match event {
            tauri::RunEvent::Ready | tauri::RunEvent::Resumed => {
                install_ios_webview_termination_recovery(app_handle);
            }
            tauri::RunEvent::Exit => {
                release_ios_webview_termination_proxies();
            }
            _ => {}
        }

        #[cfg(not(target_os = "ios"))]
        let _ = (app_handle, event);
    });
}
