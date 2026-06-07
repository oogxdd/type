//! Handwriting OCR: save attachments, OCR queue (OpenAI / HuggingFace), listing.
//!
//! Per-provider HTTP transcription lives in submodules (openai.rs,
//! huggingface.rs); this hub owns attachment saving, the OCR queue + worker,
//! note scanning, and the provider dispatch.

use serde::{Deserialize, Serialize};
use std::{
    collections::{HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    thread,
    time::Duration,
};
use uuid::Uuid;

use crate::ports::handwriting::HandwritingGateway;
use crate::{
    allocate_note_file_name, collect_markdown_note_files, decode_image_base64, generate_note_id,
    is_storage_folder_path, note_parent_folder_path, notes_root, now_ms, parse_note_front_matter,
    resolve_path, sanitize_relative, strip_root, uuid_tail_without_timestamp_prefix,
    write_note_with_front_matter, NoteFileNameFormat, NoteFrontMatter, ATTACHMENTS_STORAGE_FOLDER,
    FEED_FOLDER, RECORDING_STATUS_COMPLETED, RECORDING_STATUS_FAILED, RECORDING_STATUS_PENDING,
    RECORDING_STATUS_PROCESSING,
};

mod huggingface;
mod openai;

use huggingface::transcribe_handwriting_with_huggingface;
use openai::transcribe_handwriting_with_openai;

// ── Constants ──────────────────────────────────────────────────────────────────

const ATTACHMENT_FILE_NAME_PREFIX: &str = "attachment";
pub(crate) const HANDWRITING_FRONTMATTER_TYPE: &str = "handwriting_attachment";
const HANDWRITING_OCR_PROMPT: &str = "Extract all handwritten text from this image. Return plain text only, preserving line breaks and paragraphs. Do not add commentary.";
const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const HUGGINGFACE_INFERENCE_BASE_URL: &str = "https://api-inference.huggingface.co/models";
const HUGGINGFACE_RETRYABLE_STATUS: reqwest::StatusCode = reqwest::StatusCode::SERVICE_UNAVAILABLE;
const HUGGINGFACE_MAX_RETRIES: usize = 5;
const HUGGINGFACE_RETRY_DELAY: Duration = Duration::from_secs(2);

// ── Types ──────────────────────────────────────────────────────────────────────

/// Arguments for saving a handwriting image attachment.
#[derive(Deserialize)]
pub(crate) struct SaveHandwritingAttachmentArgs {
    pub(crate) image_base64: String,
    pub(crate) mime_type: Option<String>,
    pub(crate) file_name: Option<String>,
    pub(crate) folder_path: Option<String>,
    #[serde(default)]
    pub(crate) file_name_format: NoteFileNameFormat,
}

#[derive(Serialize)]
/// Paths returned after successfully writing a handwriting note and attachment.
pub(crate) struct HandwritingAttachmentWriteResult {
    pub(crate) folder_path: String,
    pub(crate) note_path: String,
    pub(crate) attachment_path: String,
}

#[derive(Deserialize)]
/// Arguments for queuing OCR (provider name, API key, model).
pub(crate) struct QueueHandwritingOcrArgs {
    pub(crate) provider: String,
    pub(crate) api_key: String,
    pub(crate) model: String,
}

#[derive(Serialize)]
/// Summary returned after scanning and queuing handwriting notes for OCR.
pub(crate) struct HandwritingOcrQueueResult {
    pub(crate) scanned: usize,
    pub(crate) queued: usize,
    pub(crate) skipped: usize,
    pub(crate) in_flight: usize,
}

#[derive(Serialize)]
/// Current state of the OCR worker queue.
pub(crate) struct HandwritingOcrQueueSnapshot {
    pub(crate) running: bool,
    pub(crate) current_note: Option<String>,
    pub(crate) pending: Vec<String>,
    pub(crate) in_flight: usize,
}

#[derive(Serialize)]
/// Single handwriting entry for the frontend list.
pub(crate) struct HandwritingOcrListItem {
    pub(crate) note_path: String,
    pub(crate) folder_path: String,
    pub(crate) attachment_path: Option<String>,
    pub(crate) status: String,
    pub(crate) error: Option<String>,
    pub(crate) updated_ms: Option<i64>,
    pub(crate) is_queued: bool,
    pub(crate) is_processing: bool,
}

#[derive(Serialize)]
/// Combined queue snapshot and handwriting list for the frontend.
pub(crate) struct HandwritingOcrListResult {
    pub(crate) queue: HandwritingOcrQueueSnapshot,
    pub(crate) jobs: Vec<HandwritingOcrListItem>,
}

#[derive(Copy, Clone)]
/// Supported OCR backend providers.
pub(crate) enum HandwritingOcrProvider {
    OpenAi,
    HuggingFace,
}

#[derive(Clone)]
/// A single pending OCR job in the queue.
pub(crate) struct QueuedHandwritingOcrJob {
    pub(crate) note_rel: String,
    pub(crate) note_path: PathBuf,
    pub(crate) attachment_path: PathBuf,
    pub(crate) provider: HandwritingOcrProvider,
    pub(crate) api_key: String,
    pub(crate) model: String,
}

#[derive(Clone)]
/// Parsed info for a handwriting note found during scanning.
pub(crate) struct HandwritingNoteInfo {
    pub(crate) note_rel: String,
    pub(crate) note_path: PathBuf,
    pub(crate) attachment_rel: String,
    pub(crate) attachment_path: PathBuf,
    pub(crate) status: String,
    pub(crate) error: Option<String>,
    pub(crate) updated_ms: Option<i64>,
}

#[derive(Default)]
/// In-memory state for the background OCR worker.
pub(crate) struct HandwritingOcrQueueState {
    pub(crate) running: bool,
    pub(crate) current_note: Option<String>,
    pub(crate) pending: VecDeque<QueuedHandwritingOcrJob>,
    pub(crate) known_notes: HashSet<String>,
}

/// Tauri-backed handwriting gateway. It owns attachment persistence and the
/// process-global OCR queue.
pub(crate) struct TauriHandwritingAdapter {
    app: tauri::AppHandle,
}

impl TauriHandwritingAdapter {
    pub(crate) fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl HandwritingGateway for TauriHandwritingAdapter {
    type SaveArgs = SaveHandwritingAttachmentArgs;
    type WriteResult = HandwritingAttachmentWriteResult;
    type QueueArgs = QueueHandwritingOcrArgs;
    type QueueResult = HandwritingOcrQueueResult;
    type ListResult = HandwritingOcrListResult;

    fn save(&self, args: Self::SaveArgs) -> Result<Self::WriteResult, String> {
        let root = crate::ensured_notes_root(&self.app)?;
        let image_bytes = decode_image_base64(&args.image_base64)?;
        if image_bytes.is_empty() {
            return Err("Image payload is empty.".to_string());
        }

        let extension =
            supported_image_extension(args.mime_type.as_deref(), args.file_name.as_deref())?;
        let (target_folder_rel, target_folder_path) =
            resolve_handwriting_target_folder(&self.app, args.folder_path.as_deref())?;
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
        if !crate::is_feed_folder_path(&root, &target_folder_path) {
            crate::update_order_append(&target_folder_path, &[note_file_name], false)?;
        }

        Ok(HandwritingAttachmentWriteResult {
            folder_path: target_folder_rel,
            note_path: strip_root(&root, &note_path),
            attachment_path: strip_root(&root, &attachment_path),
        })
    }

    fn queue(&self, args: Self::QueueArgs) -> Result<Self::QueueResult, String> {
        let provider = parse_handwriting_ocr_provider(&args.provider)?;
        let api_key = args.api_key.trim();
        if api_key.is_empty() {
            return Err("OCR API key is required.".to_string());
        }
        let model = args.model.trim();
        if model.is_empty() {
            return Err("OCR model is required.".to_string());
        }

        let root = crate::ensured_notes_root(&self.app)?;
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
                crate::RECORDING_STATUS_QUEUED | RECORDING_STATUS_PROCESSING
            ) && is_active
            {
                skipped += 1;
                continue;
            }

            update_handwriting_note_status(
                &note.note_path,
                crate::RECORDING_STATUS_QUEUED,
                None,
                None,
            )?;
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

    fn list(&self) -> Result<Self::ListResult, String> {
        let root = crate::ensured_notes_root(&self.app)?;
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
}

// ── Static ─────────────────────────────────────────────────────────────────────

static HANDWRITING_OCR_QUEUE: OnceLock<Mutex<HandwritingOcrQueueState>> = OnceLock::new();

// ── Queue state ────────────────────────────────────────────────────────────────

/// Access the global OCR queue mutex.
pub(crate) fn handwriting_ocr_queue_state() -> &'static Mutex<HandwritingOcrQueueState> {
    HANDWRITING_OCR_QUEUE.get_or_init(|| Mutex::new(HandwritingOcrQueueState::default()))
}

/// Collect note paths that are currently queued or being OCR-processed.
pub(crate) fn active_handwriting_note_paths() -> HashSet<String> {
    let queue = handwriting_ocr_queue_state();
    let state = queue.lock().expect("handwriting ocr queue poisoned");
    let mut active = HashSet::with_capacity(state.pending.len() + 1);
    if let Some(current) = &state.current_note {
        active.insert(current.clone());
    }
    active.extend(state.pending.iter().map(|job| job.note_rel.clone()));
    active
}

/// Snapshot the current OCR queue state for the frontend.
pub(crate) fn handwriting_queue_snapshot() -> HandwritingOcrQueueSnapshot {
    let queue = handwriting_ocr_queue_state();
    let state = queue.lock().expect("handwriting ocr queue poisoned");
    let pending = state
        .pending
        .iter()
        .map(|job| job.note_rel.clone())
        .collect::<Vec<_>>();
    HandwritingOcrQueueSnapshot {
        running: state.running,
        current_note: state.current_note.clone(),
        in_flight: pending.len() + usize::from(state.running),
        pending,
    }
}

/// Parse a provider string into the corresponding enum variant.
pub(crate) fn parse_handwriting_ocr_provider(
    value: &str,
) -> Result<HandwritingOcrProvider, String> {
    let normalized = value.trim().to_lowercase();
    match normalized.as_str() {
        "openai" => Ok(HandwritingOcrProvider::OpenAi),
        "huggingface" => Ok(HandwritingOcrProvider::HuggingFace),
        _ => Err(format!(
            "Unsupported OCR provider: {}. Expected \"openai\" or \"huggingface\".",
            value
        )),
    }
}

// ── Image helpers ──────────────────────────────────────────────────────────────

/// Normalize a raw extension or MIME fragment to a canonical image extension.
pub(crate) fn normalize_image_extension(value: &str) -> Option<&'static str> {
    match value.trim().to_lowercase().as_str() {
        "png" => Some("png"),
        "jpg" | "jpeg" => Some("jpg"),
        "webp" => Some("webp"),
        "gif" => Some("gif"),
        _ => None,
    }
}

fn image_extension_from_mime(mime_type: Option<&str>) -> Option<&'static str> {
    let raw = mime_type?;
    let normalized = raw.trim().to_lowercase();
    if normalized.contains("png") {
        return Some("png");
    }
    if normalized.contains("jpeg") || normalized.contains("jpg") {
        return Some("jpg");
    }
    if normalized.contains("webp") {
        return Some("webp");
    }
    if normalized.contains("gif") {
        return Some("gif");
    }
    None
}

fn image_extension_from_file_name(file_name: Option<&str>) -> Option<&'static str> {
    let raw = file_name?;
    let ext = Path::new(raw)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    normalize_image_extension(ext)
}

fn image_mime_from_extension(extension: &str) -> &'static str {
    match extension {
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    }
}

/// Determine a supported image extension from filename, MIME type, or defaults.
pub(crate) fn supported_image_extension(
    mime_type: Option<&str>,
    file_name: Option<&str>,
) -> Result<&'static str, String> {
    if let Some(ext) = image_extension_from_mime(mime_type) {
        return Ok(ext);
    }
    if let Some(ext) = image_extension_from_file_name(file_name) {
        return Ok(ext);
    }
    Err("Unsupported image type. Supported formats: png, jpg/jpeg, webp, gif.".to_string())
}

// ── Note body ──────────────────────────────────────────────────────────────────

fn handwriting_note_body(status: &str, text: Option<&str>) -> String {
    if status != RECORDING_STATUS_COMPLETED {
        return String::new();
    }
    let value = text.unwrap_or_default().trim();
    if value.is_empty() {
        String::new()
    } else {
        format!("{}\n", value)
    }
}

fn handwriting_storage_root(root: &Path) -> PathBuf {
    root.join(ATTACHMENTS_STORAGE_FOLDER)
}

fn is_handwriting_attachment_path_allowed(root: &Path, attachment_path: &Path) -> bool {
    attachment_path.starts_with(handwriting_storage_root(root))
}

// ── Note scanning ──────────────────────────────────────────────────────────────

fn handwriting_info_from_note_meta(
    root: &Path,
    note_path: &Path,
    note_rel: &str,
    meta: &NoteFrontMatter,
) -> Option<HandwritingNoteInfo> {
    if meta.note_type.as_deref() != Some(HANDWRITING_FRONTMATTER_TYPE) {
        return None;
    }
    let attachment_rel = meta.handwriting_attachment_path.as_ref()?.trim();
    if attachment_rel.is_empty() {
        return None;
    }
    let attachment_rel_path = sanitize_relative(attachment_rel).ok()?;
    let attachment_path = root.join(&attachment_rel_path);
    if !is_handwriting_attachment_path_allowed(root, &attachment_path) {
        return None;
    }
    let status = meta
        .ocr_status
        .as_deref()
        .unwrap_or(RECORDING_STATUS_PENDING)
        .to_string();
    Some(HandwritingNoteInfo {
        note_rel: note_rel.to_string(),
        note_path: note_path.to_path_buf(),
        attachment_rel: attachment_rel_path.to_string_lossy().replace('\\', "/"),
        attachment_path,
        status,
        error: meta.ocr_error.clone(),
        updated_ms: meta.ocr_updated_ms.or(meta.updated_ms),
    })
}

/// Scan all markdown notes and extract handwriting attachment metadata.
pub(crate) fn collect_handwriting_notes(root: &Path) -> Result<Vec<HandwritingNoteInfo>, String> {
    let mut note_files = Vec::new();
    collect_markdown_note_files(root, root, &mut note_files)?;
    let mut notes = Vec::new();
    for note_path in note_files {
        let raw = match fs::read_to_string(&note_path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let (meta, _) = parse_note_front_matter(&raw);
        let note_rel = strip_root(root, &note_path);
        if let Some(info) = handwriting_info_from_note_meta(root, &note_path, &note_rel, &meta) {
            notes.push(info);
        }
    }
    Ok(notes)
}

/// Update a handwriting note's OCR status and body on disk.
pub(crate) fn update_handwriting_note_status(
    note_path: &Path,
    status: &str,
    error: Option<String>,
    extracted_text: Option<&str>,
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
    meta.note_type = Some(HANDWRITING_FRONTMATTER_TYPE.to_string());
    meta.ocr_status = Some(status.to_string());
    meta.ocr_error = error;
    meta.ocr_updated_ms = now.or(meta.ocr_updated_ms);
    let next_body = handwriting_note_body(status, extracted_text);
    write_note_with_front_matter(note_path, &meta, &next_body)
}

fn run_handwriting_ocr_job(
    provider: HandwritingOcrProvider,
    image_bytes: &[u8],
    mime_type: &str,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    match provider {
        HandwritingOcrProvider::OpenAi => {
            transcribe_handwriting_with_openai(image_bytes, mime_type, api_key, model)
        }
        HandwritingOcrProvider::HuggingFace => {
            transcribe_handwriting_with_huggingface(image_bytes, mime_type, api_key, model)
        }
    }
}

// ── Worker ─────────────────────────────────────────────────────────────────────

fn process_handwriting_ocr_job(job: QueuedHandwritingOcrJob) {
    if let Err(error) =
        update_handwriting_note_status(&job.note_path, RECORDING_STATUS_PROCESSING, None, None)
    {
        eprintln!(
            "[handwriting] failed to mark processing for {}: {}",
            job.note_rel, error
        );
    }

    let run = || -> Result<String, String> {
        let image_bytes = fs::read(&job.attachment_path).map_err(|error| error.to_string())?;
        let extension = job
            .attachment_path
            .extension()
            .and_then(|value| value.to_str())
            .and_then(normalize_image_extension)
            .ok_or_else(|| "Unsupported attachment format.".to_string())?;
        let mime_type = image_mime_from_extension(extension);
        run_handwriting_ocr_job(
            job.provider,
            &image_bytes,
            mime_type,
            &job.api_key,
            &job.model,
        )
    };

    match run() {
        Ok(extracted_text) => {
            if let Err(error) = update_handwriting_note_status(
                &job.note_path,
                RECORDING_STATUS_COMPLETED,
                None,
                Some(&extracted_text),
            ) {
                eprintln!(
                    "[handwriting] failed to write OCR text for {}: {}",
                    job.note_rel, error
                );
            }
        }
        Err(error) => {
            let _ = update_handwriting_note_status(
                &job.note_path,
                RECORDING_STATUS_FAILED,
                Some(error.clone()),
                None,
            );
            eprintln!("[handwriting] OCR failed for {}: {}", job.note_rel, error);
        }
    }
}

/// Start a background worker thread if OCR jobs are queued and none is running.
pub(crate) fn spawn_handwriting_ocr_worker_if_needed() {
    let should_spawn = {
        let queue = handwriting_ocr_queue_state();
        let mut state = queue.lock().expect("handwriting ocr queue poisoned");
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
            let queue = handwriting_ocr_queue_state();
            let mut state = queue.lock().expect("handwriting ocr queue poisoned");
            match state.pending.pop_front() {
                Some(job) => {
                    state.current_note = Some(job.note_rel.clone());
                    Some(job)
                }
                None => {
                    state.running = false;
                    state.current_note = None;
                    None
                }
            }
        };
        let Some(job) = maybe_job else {
            break;
        };
        process_handwriting_ocr_job(job.clone());
        let queue = handwriting_ocr_queue_state();
        let mut state = queue.lock().expect("handwriting ocr queue poisoned");
        state.known_notes.remove(&job.note_rel);
        if state.current_note.as_deref() == Some(job.note_rel.as_str()) {
            state.current_note = None;
        }
    });
}

// ── File allocation ────────────────────────────────────────────────────────────

/// Default body for a newly created handwriting note (empty).
pub(crate) fn handwriting_initial_body() -> String {
    String::new()
}

/// Generate a unique filename for a handwriting note.
pub(crate) fn handwriting_note_file_name(
    folder: &Path,
    timestamp_ms: i64,
    note_id: &str,
    file_name_format: NoteFileNameFormat,
) -> Result<String, String> {
    let fallback = format!(
        "handwriting-{}",
        uuid_tail_without_timestamp_prefix(note_id)
    );
    allocate_note_file_name(
        folder,
        timestamp_ms,
        note_id,
        "",
        &fallback,
        file_name_format,
    )
}

/// Allocate a unique attachment file path inside the Attachments storage folder.
pub(crate) fn handwriting_attachment_file_path(
    root: &Path,
    extension: &str,
) -> Result<PathBuf, String> {
    let storage = handwriting_storage_root(root);
    fs::create_dir_all(&storage).map_err(|error| error.to_string())?;
    for _ in 0..=512usize {
        let candidate = storage.join(format!(
            "{}-{}.{}",
            ATTACHMENT_FILE_NAME_PREFIX,
            Uuid::now_v7(),
            extension
        ));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Failed to allocate attachment filename.".to_string())
}

/// Resolve the target folder for a new handwriting note, falling back to Feed.
pub(crate) fn resolve_handwriting_target_folder(
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
