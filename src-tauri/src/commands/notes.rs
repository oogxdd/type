use crate::*;

#[tauri::command]
pub(super) fn get_tree(app: tauri::AppHandle) -> Result<FolderNode, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    build_folder_node(&root, "")
}

#[tauri::command]
pub(super) fn read_note(app: tauri::AppHandle, path: String) -> Result<String, String> {
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
pub(super) fn create_note(
    app: tauri::AppHandle,
    args: CreateNoteArgs,
) -> Result<CreateNoteResult, String> {
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
pub(super) fn write_note(
    app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<(), String> {
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
pub(super) fn set_note_timestamp(
    app: tauri::AppHandle,
    args: SetNoteTimestampArgs,
) -> Result<(), String> {
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
pub(super) fn get_note_meta(
    app: tauri::AppHandle,
    path: String,
) -> Result<NoteMeta, String> {
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
pub(super) fn move_items(
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
pub(super) fn delete_items(app: tauri::AppHandle, items: Vec<String>) -> Result<(), String> {
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
pub(super) fn rename_item(
    app: tauri::AppHandle,
    path: String,
    new_name: String,
) -> Result<String, String> {
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
pub(super) fn set_order(app: tauri::AppHandle, args: SetOrderArgs) -> Result<(), String> {
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
