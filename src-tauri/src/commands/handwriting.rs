use crate::*;

#[tauri::command]
pub(super) fn save_handwriting_attachment(
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
pub(super) fn queue_handwriting_ocr(
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
pub(super) fn list_handwriting_ocr_jobs(
    app: tauri::AppHandle,
) -> Result<HandwritingOcrListResult, String> {
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
