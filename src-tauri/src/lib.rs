use git2::{
    build::CheckoutBuilder, AnnotatedCommit, Cred, CredentialType, Direction, FetchOptions,
    IndexAddOption, Oid, PushOptions, RemoteCallbacks, Repository, Signature, StatusOptions,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
    thread,
    time::Duration,
};
use tauri::Manager;
use uuid::Uuid;

const ORDER_FILE: &str = ".notes-order.json";
const SESSIONS_FILE: &str = ".notes-sessions.json";
const UNSORTED_FOLDER: &str = "Unsorted";
const ARCHIEVE_FOLDER: &str = "Archieve";
const RECORDINGS_FOLDER: &str = "Recordings";
const TRANSCRIPT_FILE_NAME: &str = "transcript.md";
const TRANSCRIPTION_STATUS_FILE: &str = ".transcription-status.json";
const AUDIO_FILE_NAME_PREFIX: &str = "audio";
const ASSEMBLY_UPLOAD_URL: &str = "https://api.assemblyai.com/v2/upload";
const ASSEMBLY_TRANSCRIPT_URL: &str = "https://api.assemblyai.com/v2/transcript";
const ASSEMBLY_SPEECH_MODEL: &str = "universal-2";
const ASSEMBLY_POLL_INTERVAL: Duration = Duration::from_secs(2);
const ASSEMBLY_MAX_POLL_ATTEMPTS: usize = 180;
const SYSTEM_FOLDERS: [&str; 3] = [UNSORTED_FOLDER, ARCHIEVE_FOLDER, RECORDINGS_FOLDER];
#[cfg(target_os = "macos")]
const MACOS_WINDOW_ALPHA: f64 = 1.0;

#[cfg(target_os = "macos")]
fn apply_macos_window_alpha(window: &tauri::WebviewWindow, alpha: f64) -> tauri::Result<()> {
    use objc::{class, msg_send, sel, sel_impl};
    use objc::runtime::Object;

    let ns_window = window.ns_window()? as *mut Object;
    unsafe {
        let _: () = msg_send![ns_window, setOpaque: false];
        let ns_color: *mut Object = msg_send![class!(NSColor), clearColor];
        let _: () = msg_send![ns_window, setBackgroundColor: ns_color];
        let _: () = msg_send![ns_window, setAlphaValue: alpha];
    }
    Ok(())
}

#[derive(Serialize)]
struct NoteEntry {
    name: String,
    path: String,
}

#[derive(Serialize)]
struct NoteMeta {
    created_ms: Option<i64>,
    updated_ms: Option<i64>,
}

#[derive(Default)]
struct NoteFrontMatter {
    id: Option<String>,
    created_ms: Option<i64>,
    updated_ms: Option<i64>,
    passthrough_lines: Vec<String>,
}

#[derive(Deserialize)]
struct SetOrderArgs {
    parent: String,
    #[serde(rename = "folderOrder")]
    folder_order: Vec<String>,
    #[serde(rename = "noteOrder")]
    note_order: Vec<String>,
}

#[derive(Deserialize)]
struct ConnectGitArgs {
    remote_url: String,
    branch: Option<String>,
    username: Option<String>,
    password: Option<String>,
}

#[derive(Deserialize)]
struct GitSyncArgs {
    branch: Option<String>,
    username: Option<String>,
    password: Option<String>,
}

#[derive(Deserialize)]
struct GitPushArgs {
    message: Option<String>,
    branch: Option<String>,
    username: Option<String>,
    password: Option<String>,
}

#[derive(Serialize)]
struct FolderNode {
    name: String,
    path: String,
    children: Vec<FolderNode>,
    notes: Vec<NoteEntry>,
}

#[derive(Default, Deserialize, Serialize)]
struct OrderFile {
    #[serde(default)]
    folder_order: Vec<String>,
    #[serde(default)]
    note_order: Vec<String>,
}

#[derive(Serialize)]
struct GitSyncStatus {
    git_available: bool,
    repo_initialized: bool,
    current_branch: Option<String>,
    remote_url: Option<String>,
    has_uncommitted_changes: bool,
    push_required: bool,
    ahead: usize,
    behind: usize,
    notes_root: String,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
struct NotesSessionEntry {
    id: String,
    name: String,
    notes_root: String,
}

#[derive(Clone, Default, Deserialize, PartialEq, Serialize)]
struct NotesSessionsFile {
    active_session_id: String,
    sessions: Vec<NotesSessionEntry>,
}

#[derive(Serialize)]
struct NotesSessionsSnapshot {
    active_session_id: String,
    sessions: Vec<NotesSessionEntry>,
}

#[derive(Deserialize)]
struct CreateSessionArgs {
    name: String,
}

#[derive(Deserialize)]
struct SetActiveSessionArgs {
    session_id: String,
}

#[derive(Deserialize)]
struct SaveRecordingArgs {
    audio_base64: String,
    mime_type: Option<String>,
}

#[derive(Serialize)]
struct RecordingWriteResult {
    recording_folder: String,
    audio_path: String,
    transcript_path: String,
    status_path: String,
}

#[derive(Deserialize)]
struct QueueRecordingsArgs {
    assembly_api_key: String,
}

#[derive(Serialize)]
struct RecordingTranscriptionQueueResult {
    scanned: usize,
    queued: usize,
    skipped: usize,
    in_flight: usize,
}

#[derive(Serialize)]
struct RecordingQueueSnapshot {
    running: bool,
    current_recording: Option<String>,
    pending: Vec<String>,
    in_flight: usize,
}

#[derive(Serialize)]
struct RecordingListItem {
    recording_folder: String,
    audio_path: Option<String>,
    transcript_path: String,
    status_path: String,
    status: String,
    error: Option<String>,
    updated_ms: Option<i64>,
    is_queued: bool,
    is_processing: bool,
}

#[derive(Serialize)]
struct RecordingsListResult {
    queue: RecordingQueueSnapshot,
    recordings: Vec<RecordingListItem>,
}

#[derive(Deserialize)]
struct ReadRecordingAudioArgs {
    path: String,
}

#[derive(Serialize)]
struct RecordingAudioPayload {
    mime_type: String,
    audio_base64: String,
}

#[derive(Clone, Deserialize, Serialize)]
struct RecordingTranscriptionState {
    status: String,
    audio_file: String,
    transcript_file: String,
    transcript_id: Option<String>,
    error: Option<String>,
    updated_ms: Option<i64>,
}

#[derive(Clone)]
struct QueuedTranscriptionJob {
    recording_rel: String,
    audio_path: PathBuf,
    status_path: PathBuf,
    transcript_path: PathBuf,
    api_key: String,
}

#[derive(Default)]
struct TranscriptionQueueState {
    running: bool,
    current_recording: Option<String>,
    pending: VecDeque<QueuedTranscriptionJob>,
    known_recordings: HashSet<String>,
}

#[derive(Deserialize)]
struct AssemblyUploadResponse {
    upload_url: String,
}

#[derive(Deserialize)]
struct AssemblyTranscriptResponse {
    id: String,
    status: String,
    text: Option<String>,
    error: Option<String>,
}

static TRANSCRIPTION_QUEUE: OnceLock<Mutex<TranscriptionQueueState>> = OnceLock::new();
static GIT_NOTE_TIMESTAMPS_CACHE: OnceLock<Mutex<HashMap<String, (Option<i64>, Option<i64>)>>> =
    OnceLock::new();

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_data_dir().map_err(|err| err.to_string())?;
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|err| err.to_string())?;
    }
    Ok(path)
}

fn sessions_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(SESSIONS_FILE))
}

fn session_root_for_id(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("sessions").join(id).join("notes"))
}

fn legacy_notes_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("NOTES_ROOT") {
        let root = PathBuf::from(path);
        if root.exists() {
            return Ok(root);
        }
    }

    let cwd = std::env::current_dir().map_err(|err| err.to_string())?;
    let direct = cwd.join("notes");
    if direct.exists() {
        return Ok(direct);
    }
    let parent = cwd.join("..").join("notes");
    if parent.exists() {
        return Ok(parent);
    }

    let app_data = app_data_dir(app)?;
    let root = app_data.join("notes");
    if !root.exists() {
        fs::create_dir_all(&root).map_err(|err| err.to_string())?;
    }
    Ok(root)
}

fn normalize_session_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        "Session".to_string()
    } else {
        trimmed.to_string()
    }
}

fn slugify_session_id(name: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in name.chars() {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            slug.push(lower);
            last_dash = false;
            continue;
        }
        if !last_dash && !slug.is_empty() {
            slug.push('-');
            last_dash = true;
        }
    }
    let compact = slug.trim_matches('-').to_string();
    if compact.is_empty() {
        "session".to_string()
    } else {
        compact
    }
}

fn default_sessions_state(app: &tauri::AppHandle) -> Result<NotesSessionsFile, String> {
    let legacy_root = legacy_notes_root(app)?;
    if !legacy_root.exists() {
        fs::create_dir_all(&legacy_root).map_err(|err| err.to_string())?;
    }
    Ok(NotesSessionsFile {
        active_session_id: "default".to_string(),
        sessions: vec![NotesSessionEntry {
            id: "default".to_string(),
            name: "Default".to_string(),
            notes_root: legacy_root.to_string_lossy().to_string(),
        }],
    })
}

fn write_sessions_state(app: &tauri::AppHandle, state: &NotesSessionsFile) -> Result<(), String> {
    let path = sessions_file_path(app)?;
    let content = serde_json::to_string_pretty(state).map_err(|err| err.to_string())?;
    fs::write(path, content).map_err(|err| err.to_string())
}

fn normalize_sessions_state(
    app: &tauri::AppHandle,
    mut state: NotesSessionsFile,
) -> Result<NotesSessionsFile, String> {
    let mut seen = HashSet::new();
    let mut sessions = Vec::new();
    for mut session in state.sessions.drain(..) {
        let id = session.id.trim().to_string();
        if id.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        session.id = id.clone();
        session.name = normalize_session_name(&session.name);
        if session.notes_root.trim().is_empty() {
            session.notes_root = session_root_for_id(app, &id)?.to_string_lossy().to_string();
        }
        let root = PathBuf::from(&session.notes_root);
        if !root.exists() {
            fs::create_dir_all(&root).map_err(|err| err.to_string())?;
        }
        sessions.push(session);
    }

    if sessions.is_empty() {
        return default_sessions_state(app);
    }

    let active_session_id = if sessions
        .iter()
        .any(|session| session.id == state.active_session_id)
    {
        state.active_session_id
    } else {
        sessions[0].id.clone()
    };

    Ok(NotesSessionsFile {
        active_session_id,
        sessions,
    })
}

fn ensure_sessions_state(app: &tauri::AppHandle) -> Result<NotesSessionsFile, String> {
    let path = sessions_file_path(app)?;
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
        return match serde_json::from_str::<NotesSessionsFile>(&content) {
            Ok(parsed) => {
                let normalized = normalize_sessions_state(app, parsed.clone())?;
                if normalized != parsed {
                    write_sessions_state(app, &normalized)?;
                }
                Ok(normalized)
            }
            Err(_) => {
                let state = default_sessions_state(app)?;
                write_sessions_state(app, &state)?;
                Ok(state)
            }
        };
    }

    let state = default_sessions_state(app)?;
    write_sessions_state(app, &state)?;
    Ok(state)
}

fn sessions_snapshot(state: &NotesSessionsFile) -> NotesSessionsSnapshot {
    NotesSessionsSnapshot {
        active_session_id: state.active_session_id.clone(),
        sessions: state.sessions.clone(),
    }
}

fn find_session<'a>(state: &'a NotesSessionsFile, session_id: &str) -> Option<&'a NotesSessionEntry> {
    state.sessions.iter().find(|session| session.id == session_id)
}

fn set_active_session_state(
    app: &tauri::AppHandle,
    session_id: &str,
) -> Result<NotesSessionsFile, String> {
    let mut state = ensure_sessions_state(app)?;
    let id = session_id.trim();
    if id.is_empty() {
        return Err("Session id is required.".to_string());
    }
    if find_session(&state, id).is_none() {
        return Err(format!("Session not found: {}", id));
    }
    state.active_session_id = id.to_string();
    write_sessions_state(app, &state)?;
    Ok(state)
}

fn create_session_state(app: &tauri::AppHandle, name: &str) -> Result<NotesSessionsFile, String> {
    let mut state = ensure_sessions_state(app)?;
    let session_name = normalize_session_name(name);
    let base_id = slugify_session_id(&session_name);
    let existing: HashSet<String> = state.sessions.iter().map(|session| session.id.clone()).collect();
    let mut session_id = base_id.clone();
    let mut suffix = 2usize;
    while existing.contains(&session_id) {
        session_id = format!("{}-{}", base_id, suffix);
        suffix += 1;
    }

    let session_root = session_root_for_id(app, &session_id)?;
    if !session_root.exists() {
        fs::create_dir_all(&session_root).map_err(|err| err.to_string())?;
    }

    state.sessions.push(NotesSessionEntry {
        id: session_id.clone(),
        name: session_name,
        notes_root: session_root.to_string_lossy().to_string(),
    });
    state.active_session_id = session_id;
    write_sessions_state(app, &state)?;
    Ok(state)
}

fn notes_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = match ensure_sessions_state(app) {
        Ok(state) => {
            let active = find_session(&state, &state.active_session_id)
                .or_else(|| state.sessions.first())
                .ok_or_else(|| "No sessions configured.".to_string())?;
            PathBuf::from(&active.notes_root)
        }
        Err(_) => legacy_notes_root(app)?,
    };
    if !root.exists() {
        fs::create_dir_all(&root).map_err(|err| err.to_string())?;
    }
    Ok(root)
}

fn sanitize_relative(path: &str) -> Result<PathBuf, String> {
    if path.is_empty() {
        return Ok(PathBuf::new());
    }
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err("Absolute paths are not allowed.".to_string());
    }
    for component in candidate.components() {
        match component {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Invalid path traversal.".to_string())
            }
            _ => {}
        }
    }
    Ok(candidate.to_path_buf())
}

fn resolve_path(app: &tauri::AppHandle, rel: &str) -> Result<PathBuf, String> {
    let root = notes_root(app)?;
    let rel_path = sanitize_relative(rel)?;
    Ok(root.join(rel_path))
}

fn transcription_queue_state() -> &'static Mutex<TranscriptionQueueState> {
    TRANSCRIPTION_QUEUE.get_or_init(|| Mutex::new(TranscriptionQueueState::default()))
}

fn now_ms() -> Option<i64> {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?;
    i64::try_from(duration.as_millis()).ok()
}

fn parse_note_front_matter(raw: &str) -> (NoteFrontMatter, String) {
    let mut meta = NoteFrontMatter::default();
    let normalized = raw.replace("\r\n", "\n");
    if !normalized.starts_with("---\n") {
        return (meta, raw.to_string());
    }
    let Some(close_marker_index) = normalized[4..].find("\n---\n") else {
        return (meta, raw.to_string());
    };
    let header_end = 4 + close_marker_index;
    let header = &normalized[4..header_end];
    let body = &normalized[(header_end + 5)..];

    for line in header.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some((key_raw, value_raw)) = trimmed.split_once(':') else {
            meta.passthrough_lines.push(trimmed.to_string());
            continue;
        };
        let key = key_raw.trim().to_lowercase();
        let value = value_raw
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        match key.as_str() {
            "id" => {
                if !value.is_empty() {
                    meta.id = Some(value);
                }
            }
            "created_ms" => {
                if let Ok(parsed) = value.parse::<i64>() {
                    meta.created_ms = Some(parsed);
                } else {
                    meta.passthrough_lines.push(trimmed.to_string());
                }
            }
            "updated_ms" => {
                if let Ok(parsed) = value.parse::<i64>() {
                    meta.updated_ms = Some(parsed);
                } else {
                    meta.passthrough_lines.push(trimmed.to_string());
                }
            }
            _ => meta.passthrough_lines.push(trimmed.to_string()),
        }
    }

    (meta, body.to_string())
}

fn front_matter_safe_value(value: &str) -> String {
    if value
        .chars()
        .all(|char| char.is_ascii_alphanumeric() || matches!(char, '-' | '_' | '.'))
    {
        value.to_string()
    } else {
        format!("{:?}", value)
    }
}

fn render_note_with_front_matter(meta: &NoteFrontMatter, body: &str) -> String {
    let mut output = String::new();
    output.push_str("---\n");
    if let Some(id) = &meta.id {
        output.push_str(&format!("id: {}\n", front_matter_safe_value(id)));
    }
    if let Some(created_ms) = meta.created_ms {
        output.push_str(&format!("created_ms: {}\n", created_ms));
    }
    if let Some(updated_ms) = meta.updated_ms {
        output.push_str(&format!("updated_ms: {}\n", updated_ms));
    }
    for line in &meta.passthrough_lines {
        output.push_str(line);
        output.push('\n');
    }
    output.push_str("---\n\n");
    output.push_str(body);
    output
}

fn generate_note_id() -> String {
    Uuid::now_v7().to_string()
}

fn audio_extension_from_mime(mime_type: Option<&str>) -> &'static str {
    let Some(raw) = mime_type else {
        return "webm";
    };
    let normalized = raw.to_lowercase();
    if normalized.contains("mp4") || normalized.contains("aac") {
        return "m4a";
    }
    if normalized.contains("mpeg") || normalized.contains("mp3") {
        return "mp3";
    }
    if normalized.contains("wav") {
        return "wav";
    }
    if normalized.contains("ogg") {
        return "ogg";
    }
    if normalized.contains("flac") {
        return "flac";
    }
    "webm"
}

fn audio_mime_from_path(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "m4a" => "audio/mp4",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "webm" => "audio/webm",
        "aac" => "audio/aac",
        "mp4" => "audio/mp4",
        "flac" => "audio/flac",
        _ => "application/octet-stream",
    }
}

fn decode_audio_base64(payload: &str) -> Result<Vec<u8>, String> {
    let trimmed = payload.trim();
    if trimmed.is_empty() {
        return Err("Audio payload is empty.".to_string());
    }
    let body = trimmed
        .split_once(',')
        .map(|(_, value)| value)
        .unwrap_or(trimmed);
    BASE64
        .decode(body)
        .map_err(|error| format!("Invalid base64 audio payload: {}", error))
}

fn response_error(status: reqwest::StatusCode, body: String, context: &str) -> String {
    let compact = body.replace('\n', " ");
    if compact.trim().is_empty() {
        format!("{} failed (HTTP {}).", context, status)
    } else {
        format!("{} failed (HTTP {}): {}", context, status, compact)
    }
}

fn read_transcription_state(path: &Path) -> Option<RecordingTranscriptionState> {
    let contents = fs::read_to_string(path).ok()?;
    serde_json::from_str::<RecordingTranscriptionState>(&contents).ok()
}

fn write_transcription_state(path: &Path, state: &RecordingTranscriptionState) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
    fs::write(path, contents).map_err(|error| error.to_string())
}

fn update_transcription_state(
    status_path: &Path,
    audio_name: &str,
    status: &str,
    transcript_id: Option<String>,
    error: Option<String>,
) -> Result<(), String> {
    let mut next = read_transcription_state(status_path).unwrap_or(RecordingTranscriptionState {
        status: "pending".to_string(),
        audio_file: audio_name.to_string(),
        transcript_file: TRANSCRIPT_FILE_NAME.to_string(),
        transcript_id: None,
        error: None,
        updated_ms: None,
    });
    next.status = status.to_string();
    next.audio_file = audio_name.to_string();
    next.transcript_file = TRANSCRIPT_FILE_NAME.to_string();
    next.transcript_id = transcript_id;
    next.error = error;
    next.updated_ms = now_ms();
    write_transcription_state(status_path, &next)
}

fn is_audio_extension(ext: &str) -> bool {
    matches!(
        ext,
        "m4a" | "mp3" | "wav" | "ogg" | "webm" | "aac" | "mp4" | "flac"
    )
}

fn find_recording_audio_file(recording_dir: &Path) -> Option<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(recording_dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter(|path| {
            let file_name = path.file_name().and_then(|value| value.to_str()).unwrap_or("");
            if file_name == TRANSCRIPTION_STATUS_FILE || file_name == TRANSCRIPT_FILE_NAME {
                return false;
            }
            let Some(ext) = path.extension().and_then(|value| value.to_str()) else {
                return false;
            };
            is_audio_extension(&ext.to_lowercase())
        })
        .collect();
    files.sort();
    files.into_iter().next()
}

fn is_recording_container(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    if find_recording_audio_file(path).is_some() {
        return true;
    }
    path.join(TRANSCRIPT_FILE_NAME).exists() || path.join(TRANSCRIPTION_STATUS_FILE).exists()
}

fn resolve_recording_note_file(root: &Path, full_path: &Path) -> PathBuf {
    let recordings_root = root.join(RECORDINGS_FOLDER);
    if full_path.starts_with(&recordings_root) && full_path.is_dir() {
        return full_path.join(TRANSCRIPT_FILE_NAME);
    }
    full_path.to_path_buf()
}

fn pending_transcript_placeholder(recording_dir: &Path) -> String {
    let folder_name = recording_dir
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("recording");
    let status = read_transcription_state(&recording_dir.join(TRANSCRIPTION_STATUS_FILE))
        .map(|value| value.status)
        .unwrap_or_else(|| "pending".to_string());
    format!(
        "# {}\n\nTranscript is not ready yet.\n\nStatus: `{}`\n",
        folder_name, status
    )
}

fn render_transcript_markdown(text: &str) -> String {
    let body = text.trim();
    if body.is_empty() {
        return "# Transcript\n\n(AssemblyAI returned an empty transcript.)\n".to_string();
    }
    format!("# Transcript\n\n{}\n", body)
}

fn transcribe_audio_bytes_with_assembly(
    audio_bytes: Vec<u8>,
    api_key: &str,
) -> Result<(String, String), String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())?;

    let upload_response = client
        .post(ASSEMBLY_UPLOAD_URL)
        .header("authorization", api_key)
        .header("content-type", "application/octet-stream")
        .body(audio_bytes)
        .send()
        .map_err(|error| format!("AssemblyAI upload request failed: {}", error))?;

    if !upload_response.status().is_success() {
        let status = upload_response.status();
        let body = upload_response.text().unwrap_or_default();
        return Err(response_error(status, body, "AssemblyAI upload"));
    }
    let upload_payload = upload_response
        .json::<AssemblyUploadResponse>()
        .map_err(|error| format!("AssemblyAI upload response parse failed: {}", error))?;

    let transcript_create_response = client
        .post(ASSEMBLY_TRANSCRIPT_URL)
        .header("authorization", api_key)
        .json(&serde_json::json!({
            "audio_url": upload_payload.upload_url,
            "speech_models": [ASSEMBLY_SPEECH_MODEL]
        }))
        .send()
        .map_err(|error| format!("AssemblyAI transcript request failed: {}", error))?;

    if !transcript_create_response.status().is_success() {
        let status = transcript_create_response.status();
        let body = transcript_create_response.text().unwrap_or_default();
        return Err(response_error(status, body, "AssemblyAI transcript request"));
    }

    let transcript_create_payload = transcript_create_response
        .json::<AssemblyTranscriptResponse>()
        .map_err(|error| format!("AssemblyAI transcript response parse failed: {}", error))?;
    let transcript_id = transcript_create_payload.id;

    for _ in 0..ASSEMBLY_MAX_POLL_ATTEMPTS {
        thread::sleep(ASSEMBLY_POLL_INTERVAL);
        let poll_response = client
            .get(format!("{}/{}", ASSEMBLY_TRANSCRIPT_URL, transcript_id))
            .header("authorization", api_key)
            .send()
            .map_err(|error| format!("AssemblyAI polling request failed: {}", error))?;

        if !poll_response.status().is_success() {
            let status = poll_response.status();
            let body = poll_response.text().unwrap_or_default();
            return Err(response_error(status, body, "AssemblyAI polling"));
        }

        let poll_payload = poll_response
            .json::<AssemblyTranscriptResponse>()
            .map_err(|error| format!("AssemblyAI polling response parse failed: {}", error))?;

        match poll_payload.status.as_str() {
            "completed" => {
                let transcript_text = poll_payload.text.unwrap_or_default();
                return Ok((transcript_text, transcript_id));
            }
            "error" => {
                return Err(
                    poll_payload
                        .error
                        .unwrap_or_else(|| "AssemblyAI reported a transcription error.".to_string()),
                );
            }
            _ => {}
        }
    }

    Err("AssemblyAI transcription timed out.".to_string())
}

fn process_transcription_job(job: QueuedTranscriptionJob) {
    let audio_name = job
        .audio_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(AUDIO_FILE_NAME_PREFIX)
        .to_string();

    if let Err(error) =
        update_transcription_state(&job.status_path, &audio_name, "processing", None, None)
    {
        eprintln!(
            "[recordings] failed to mark processing for {}: {}",
            job.recording_rel, error
        );
    }

    let run = || -> Result<String, String> {
        let audio_bytes = fs::read(&job.audio_path).map_err(|error| error.to_string())?;
        let (transcript, transcript_id) =
            transcribe_audio_bytes_with_assembly(audio_bytes, &job.api_key)?;
        fs::write(&job.transcript_path, render_transcript_markdown(&transcript))
            .map_err(|error| error.to_string())?;
        update_transcription_state(
            &job.status_path,
            &audio_name,
            "completed",
            Some(transcript_id),
            None,
        )?;
        Ok(transcript)
    };

    if let Err(error) = run() {
        let _ = update_transcription_state(
            &job.status_path,
            &audio_name,
            "failed",
            None,
            Some(error.clone()),
        );
        eprintln!(
            "[recordings] transcription failed for {}: {}",
            job.recording_rel, error
        );
    }
}

fn spawn_transcription_worker_if_needed() {
    let should_spawn = {
        let queue = transcription_queue_state();
        let mut state = queue.lock().expect("transcription queue poisoned");
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
            let queue = transcription_queue_state();
            let mut state = queue.lock().expect("transcription queue poisoned");
            match state.pending.pop_front() {
                Some(job) => {
                    state.current_recording = Some(job.recording_rel.clone());
                    Some(job)
                }
                None => {
                    state.running = false;
                    state.current_recording = None;
                    None
                }
            }
        };

        let Some(job) = maybe_job else {
            break;
        };

        process_transcription_job(job.clone());
        let queue = transcription_queue_state();
        let mut state = queue.lock().expect("transcription queue poisoned");
        state.known_recordings.remove(&job.recording_rel);
        if state.current_recording.as_deref() == Some(job.recording_rel.as_str()) {
            state.current_recording = None;
        }
    });
}

fn read_order_file(dir: &Path) -> OrderFile {
    let file_path = dir.join(ORDER_FILE);
    if let Ok(contents) = fs::read_to_string(file_path) {
        if let Ok(order) = serde_json::from_str::<OrderFile>(&contents) {
            return order;
        }
    }
    OrderFile::default()
}

fn write_order_file(dir: &Path, order: &OrderFile) -> Result<(), String> {
    let file_path = dir.join(ORDER_FILE);
    let contents = serde_json::to_string_pretty(order).map_err(|err| err.to_string())?;
    fs::write(file_path, contents).map_err(|err| err.to_string())
}

fn map_git_error(error: git2::Error) -> String {
    error.message().to_string()
}

fn open_repo(root: &Path) -> Result<Repository, String> {
    Repository::open(root).map_err(map_git_error)
}

fn git_repo_initialized(root: &Path) -> bool {
    Repository::open(root).is_ok()
}

fn git_current_branch(repo: &Repository) -> Option<String> {
    let head = repo.head().ok()?;
    if !head.is_branch() {
        return None;
    }
    head.shorthand().map(|value| value.to_string())
}

fn git_remote_url(repo: &Repository) -> Option<String> {
    let remote = repo.find_remote("origin").ok()?;
    remote.url().map(|value| value.to_string())
}

fn git_has_changes(repo: &Repository) -> bool {
    let mut status_opts = StatusOptions::new();
    status_opts
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true);
    repo.statuses(Some(&mut status_opts))
        .map(|statuses| !statuses.is_empty())
        .unwrap_or(false)
}

fn git_note_timestamps_cache() -> &'static Mutex<HashMap<String, (Option<i64>, Option<i64>)>> {
    GIT_NOTE_TIMESTAMPS_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn git_commit_timestamp_ms(commit: &git2::Commit<'_>) -> Option<i64> {
    commit.time().seconds().checked_mul(1_000)
}

fn git_tree_blob_oid(tree: &git2::Tree<'_>, path: &Path) -> Option<Oid> {
    tree.get_path(path).ok().map(|entry| entry.id())
}

fn git_note_timestamps_from_history(root: &Path, note_rel: &str) -> Option<(Option<i64>, Option<i64>)> {
    let repo = Repository::open(root).ok()?;
    let head_oid = repo.head().ok()?.target()?;
    let cache_key = format!("{}|{}|{}", root.to_string_lossy(), head_oid, note_rel);
    {
        let cache = git_note_timestamps_cache();
        let guard = cache.lock().ok()?;
        if let Some(cached) = guard.get(&cache_key) {
            return Some(*cached);
        }
    }

    let rel_path = Path::new(note_rel);
    let mut revwalk = repo.revwalk().ok()?;
    revwalk.push(head_oid).ok()?;

    let mut created_ms: Option<i64> = None;
    let mut updated_ms: Option<i64> = None;

    for oid_result in revwalk {
        let oid = oid_result.ok()?;
        let commit = repo.find_commit(oid).ok()?;
        let tree = commit.tree().ok()?;
        let current_blob = git_tree_blob_oid(&tree, rel_path);
        if current_blob.is_none() {
            continue;
        }

        let parent_blob = if commit.parent_count() > 0 {
            let parent = commit.parent(0).ok()?;
            let parent_tree = parent.tree().ok()?;
            git_tree_blob_oid(&parent_tree, rel_path)
        } else {
            None
        };

        if current_blob != parent_blob {
            let timestamp = git_commit_timestamp_ms(&commit);
            if updated_ms.is_none() {
                updated_ms = timestamp;
            }
            created_ms = timestamp;
        }
    }

    let result = (created_ms, updated_ms);
    let cache = git_note_timestamps_cache();
    if let Ok(mut guard) = cache.lock() {
        guard.insert(cache_key, result);
    }
    Some(result)
}

fn git_head_has_commit(repo: &Repository) -> bool {
    repo.head().ok().and_then(|head| head.target()).is_some()
}

fn worktree_has_only_bootstrap_artifacts(root: &Path) -> Result<bool, String> {
    for entry in fs::read_dir(root).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".git" {
            continue;
        }
        let path = entry.path();
        let metadata = entry.metadata().map_err(|err| err.to_string())?;
        if metadata.is_file() {
            if name != ORDER_FILE {
                return Ok(false);
            }
            continue;
        }
        if metadata.is_dir() {
            if !is_system_folder_name(&name) {
                return Ok(false);
            }
            let mut items = fs::read_dir(path).map_err(|err| err.to_string())?;
            if items.next().is_some() {
                return Ok(false);
            }
            continue;
        }
        return Ok(false);
    }
    Ok(true)
}

fn clear_bootstrap_artifacts(root: &Path) -> Result<(), String> {
    let order_path = root.join(ORDER_FILE);
    if order_path.exists() {
        fs::remove_file(&order_path).map_err(|err| err.to_string())?;
    }
    for folder in SYSTEM_FOLDERS {
        let path = root.join(folder);
        if !path.exists() {
            continue;
        }
        let mut items = fs::read_dir(&path).map_err(|err| err.to_string())?;
        if items.next().is_none() {
            fs::remove_dir(&path).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn prepare_bootstrap_worktree_for_sync(root: &Path, repo: &Repository) -> Result<(), String> {
    if git_head_has_commit(repo) || !git_has_changes(repo) {
        return Ok(());
    }
    if worktree_has_only_bootstrap_artifacts(root)? {
        clear_bootstrap_artifacts(root)?;
        return Ok(());
    }
    Err("Local changes detected. Push or commit before syncing.".to_string())
}

fn git_ahead_behind(repo: &Repository, branch: Option<&str>) -> (usize, usize) {
    let branch_name = match branch {
        Some(value) => value,
        None => return (0, 0),
    };
    let local = match repo.find_branch(branch_name, git2::BranchType::Local) {
        Ok(branch) => branch,
        Err(_) => return (0, 0),
    };
    let upstream = match local.upstream() {
        Ok(branch) => branch,
        Err(_) => return (0, 0),
    };
    let local_oid = match local.get().target() {
        Some(value) => value,
        None => return (0, 0),
    };
    let upstream_oid = match upstream.get().target() {
        Some(value) => value,
        None => return (0, 0),
    };
    repo.graph_ahead_behind(local_oid, upstream_oid).unwrap_or((0, 0))
}

fn git_branch_has_local_commit(repo: &Repository, branch: Option<&str>) -> bool {
    let Some(branch_name) = branch else {
        return false;
    };
    repo.find_branch(branch_name, git2::BranchType::Local)
        .ok()
        .and_then(|branch_ref| branch_ref.get().target())
        .is_some()
}

fn git_branch_has_upstream(repo: &Repository, branch: Option<&str>) -> bool {
    let Some(branch_name) = branch else {
        return false;
    };
    repo.find_branch(branch_name, git2::BranchType::Local)
        .ok()
        .and_then(|branch_ref| branch_ref.upstream().ok())
        .is_some()
}

fn build_git_status(root: &Path) -> GitSyncStatus {
    let repo = Repository::open(root).ok();
    let repo_initialized = repo.is_some();
    let current_branch = repo.as_ref().and_then(git_current_branch);
    let remote_url = repo.as_ref().and_then(git_remote_url);
    let has_uncommitted_changes = repo.as_ref().is_some_and(git_has_changes);
    let (ahead, behind) = repo
        .as_ref()
        .map(|repository| git_ahead_behind(repository, current_branch.as_deref()))
        .unwrap_or((0, 0));
    let push_required = repo
        .as_ref()
        .map(|repository| {
            if has_uncommitted_changes || ahead > 0 {
                return true;
            }
            let branch = current_branch.as_deref();
            let has_local_commit = git_branch_has_local_commit(repository, branch);
            let has_upstream = git_branch_has_upstream(repository, branch);
            has_local_commit && !has_upstream
        })
        .unwrap_or(false);
    GitSyncStatus {
        git_available: true,
        repo_initialized,
        current_branch,
        remote_url,
        has_uncommitted_changes,
        push_required,
        ahead,
        behind,
        notes_root: root.to_string_lossy().to_string(),
    }
}

fn ensure_git_repo(root: &Path) -> Result<Repository, String> {
    if let Ok(repo) = Repository::open(root) {
        return Ok(repo);
    }
    Repository::init(root).map_err(map_git_error)
}

fn resolve_target_branch(repo: &Repository, branch: Option<String>) -> String {
    let requested = branch
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    if let Some(value) = requested {
        return value;
    }
    git_current_branch(repo).unwrap_or_else(|| "main".to_string())
}

fn build_callbacks(username: Option<&str>, password: Option<&str>) -> RemoteCallbacks<'static> {
    let user = username.map(str::to_string);
    let pass = password.map(str::to_string);
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |_url, username_from_url, allowed| {
        if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
            if let (Some(user), Some(pass)) = (user.as_deref(), pass.as_deref()) {
                return Cred::userpass_plaintext(user, pass);
            }
        }
        if allowed.contains(CredentialType::SSH_KEY) {
            if let Some(name) = username_from_url {
                if let Ok(cred) = Cred::ssh_key_from_agent(name) {
                    return Ok(cred);
                }
            }
            if let Some(user) = user.as_deref() {
                if let Ok(cred) = Cred::ssh_key_from_agent(user) {
                    return Ok(cred);
                }
            }
        }
        if allowed.contains(CredentialType::DEFAULT) {
            return Cred::default();
        }
        Err(git2::Error::from_str(
            "No matching Git credentials available for this remote.",
        ))
    });
    callbacks
}

fn ensure_origin_remote(repo: &Repository, remote_url: &str) -> Result<(), String> {
    let url = remote_url.trim();
    if url.is_empty() {
        return Err("Remote repository URL is required.".to_string());
    }
    match repo.find_remote("origin") {
        Ok(_) => repo
            .remote_set_url("origin", url)
            .map_err(map_git_error)?,
        Err(_) => {
            repo.remote("origin", url).map_err(map_git_error)?;
        }
    }
    Ok(())
}

fn switch_or_prepare_branch(repo: &Repository, branch: &str) -> Result<(), String> {
    let name = branch.trim();
    if name.is_empty() {
        return Ok(());
    }
    let local_ref = format!("refs/heads/{}", name);
    if repo.find_reference(&local_ref).is_ok() {
        repo.set_head(&local_ref).map_err(map_git_error)?;
        repo.checkout_head(Some(CheckoutBuilder::new().safe()))
            .map_err(map_git_error)?;
        return Ok(());
    }
    if let Ok(head) = repo.head() {
        if let Some(head_oid) = head.target() {
            let commit = repo.find_commit(head_oid).map_err(map_git_error)?;
            repo.branch(name, &commit, false).map_err(map_git_error)?;
            repo.set_head(&local_ref).map_err(map_git_error)?;
            repo.checkout_head(Some(CheckoutBuilder::new().safe()))
                .map_err(map_git_error)?;
            return Ok(());
        }
    }
    repo.set_head(&local_ref).map_err(map_git_error)
}

fn default_signature(repo: &Repository) -> Result<Signature<'_>, String> {
    if let Ok(sig) = repo.signature() {
        return Ok(sig);
    }
    Signature::now("Type Notes Sync", "sync@local").map_err(map_git_error)
}

fn commit_all_changes(repo: &Repository, message: &str, branch: &str) -> Result<Option<Oid>, String> {
    let mut index = repo.index().map_err(map_git_error)?;
    index
        .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
        .map_err(map_git_error)?;
    index.write().map_err(map_git_error)?;
    if index.is_empty() && !git_has_changes(repo) {
        return Ok(None);
    }
    let tree_id = index.write_tree().map_err(map_git_error)?;
    let tree = repo.find_tree(tree_id).map_err(map_git_error)?;
    let sig = default_signature(repo)?;
    let update_ref = format!("refs/heads/{}", branch);
    let oid = match repo.head() {
        Ok(head) => {
            if let Some(head_oid) = head.target() {
                let parent = repo.find_commit(head_oid).map_err(map_git_error)?;
                repo.commit(Some(&update_ref), &sig, &sig, message, &tree, &[&parent])
                    .map_err(map_git_error)?
            } else {
                repo.commit(Some(&update_ref), &sig, &sig, message, &tree, &[])
                    .map_err(map_git_error)?
            }
        }
        Err(_) => repo
            .commit(Some(&update_ref), &sig, &sig, message, &tree, &[])
            .map_err(map_git_error)?,
    };
    repo.set_head(&update_ref).map_err(map_git_error)?;
    Ok(Some(oid))
}

fn perform_fetch<'a>(
    repo: &'a Repository,
    branch: &str,
    username: Option<&str>,
    password: Option<&str>,
) -> Result<AnnotatedCommit<'a>, String> {
    let mut remote = repo.find_remote("origin").map_err(map_git_error)?;
    let callbacks = build_callbacks(username, password);
    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);
    remote
        .fetch(&[branch], Some(&mut fetch_options), None)
        .map_err(map_git_error)?;
    let fetch_head = repo.find_reference("FETCH_HEAD").map_err(map_git_error)?;
    repo.reference_to_annotated_commit(&fetch_head)
        .map_err(map_git_error)
}

fn fast_forward_to(
    repo: &Repository,
    branch: &str,
    fetch_commit: &AnnotatedCommit<'_>,
) -> Result<(), String> {
    let target_oid = fetch_commit.id();
    let local_ref_name = format!("refs/heads/{}", branch);
    match repo.find_reference(&local_ref_name) {
        Ok(mut local_ref) => {
            local_ref
                .set_target(target_oid, "Fast-forward")
                .map_err(map_git_error)?;
            repo.set_head(&local_ref_name).map_err(map_git_error)?;
            repo.checkout_head(Some(CheckoutBuilder::new().safe()))
                .map_err(map_git_error)?;
        }
        Err(_) => {
            let commit = repo.find_commit(target_oid).map_err(map_git_error)?;
            repo.branch(branch, &commit, false).map_err(map_git_error)?;
            repo.set_head(&local_ref_name).map_err(map_git_error)?;
            repo.checkout_head(Some(CheckoutBuilder::new().safe()))
                .map_err(map_git_error)?;
        }
    }
    Ok(())
}

fn sort_by_order(mut names: Vec<String>, order: &[String]) -> Vec<String> {
    let mut index = HashMap::new();
    for (idx, name) in order.iter().enumerate() {
        index.insert(name, idx);
    }
    names.sort_by(|a, b| {
        let a_idx = index.get(a).copied().unwrap_or(usize::MAX);
        let b_idx = index.get(b).copied().unwrap_or(usize::MAX);
        a_idx
            .cmp(&b_idx)
            .then_with(|| a.to_lowercase().cmp(&b.to_lowercase()))
    });
    names
}

fn strip_root(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn is_system_folder_name(name: &str) -> bool {
    SYSTEM_FOLDERS.iter().any(|folder| *folder == name)
}

fn is_system_folder_path(root: &Path, path: &Path) -> bool {
    if path.parent() != Some(root) {
        return false;
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(is_system_folder_name)
}

fn ensure_system_folders(root: &Path) -> Result<(), String> {
    for folder in SYSTEM_FOLDERS {
        let path = root.join(folder);
        if path.exists() {
            continue;
        }
        fs::create_dir_all(&path).map_err(|err| {
            format!(
                "Failed to create system folder {}: {}",
                path.to_string_lossy(),
                err
            )
        })?;
    }

    let mut order = read_order_file(root);
    let mut changed = false;
    for folder in SYSTEM_FOLDERS {
        if !order.folder_order.iter().any(|name| name == folder) {
            order.folder_order.push(folder.to_string());
            changed = true;
        }
    }

    if changed {
        write_order_file(root, &order)?;
    }

    Ok(())
}

fn build_folder_node(dir: &Path, rel_path: &str) -> Result<FolderNode, String> {
    let order = read_order_file(dir);
    let mut folders = Vec::new();
    let mut notes = Vec::new();

    for entry in fs::read_dir(dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ORDER_FILE {
            continue;
        }
        let meta = entry.metadata().map_err(|err| err.to_string())?;
        if meta.is_dir() {
            if rel_path == RECORDINGS_FOLDER && is_recording_container(&path) {
                notes.push(name);
            } else {
                folders.push(name);
            }
        } else if meta.is_file() {
            if path.extension().and_then(|ext| ext.to_str()) == Some("md") {
                notes.push(name);
            }
        }
    }

    let folder_names = sort_by_order(folders, &order.folder_order);
    let note_names = sort_by_order(notes, &order.note_order);

    let mut children = Vec::new();
    for name in folder_names {
        let child_path = dir.join(&name);
        let child_rel = if rel_path.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel_path, name)
        };
        children.push(build_folder_node(&child_path, &child_rel)?);
    }

    let mut note_entries = Vec::new();
    for name in note_names {
        let note_rel = if rel_path.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel_path, name)
        };
        note_entries.push(NoteEntry {
            name,
            path: note_rel,
        });
    }

    Ok(FolderNode {
        name: if rel_path.is_empty() {
            "Notes".to_string()
        } else {
            dir.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Folder")
                .to_string()
        },
        path: rel_path.to_string(),
        children,
        notes: note_entries,
    })
}

fn update_order_remove(dir: &Path, names: &[String], is_folder: bool) -> Result<(), String> {
    let mut order = read_order_file(dir);
    if is_folder {
        order.folder_order.retain(|name| !names.contains(name));
    } else {
        order.note_order.retain(|name| !names.contains(name));
    }
    write_order_file(dir, &order)
}

fn update_order_append(dir: &Path, names: &[String], is_folder: bool) -> Result<(), String> {
    let mut order = read_order_file(dir);
    let list = if is_folder {
        &mut order.folder_order
    } else {
        &mut order.note_order
    };
    for name in names {
        if !list.contains(name) {
            list.push(name.clone());
        }
    }
    write_order_file(dir, &order)
}

fn update_order_rename(
    dir: &Path,
    old_name: &str,
    new_name: &str,
    is_folder: bool,
) -> Result<(), String> {
    let mut order = read_order_file(dir);
    let list = if is_folder {
        &mut order.folder_order
    } else {
        &mut order.note_order
    };
    if let Some(pos) = list.iter().position(|item| item == old_name) {
        list[pos] = new_name.to_string();
    }
    write_order_file(dir, &order)
}

#[tauri::command]
fn get_sessions(app: tauri::AppHandle) -> Result<NotesSessionsSnapshot, String> {
    let state = ensure_sessions_state(&app).or_else(|_| default_sessions_state(&app))?;
    Ok(sessions_snapshot(&state))
}

#[tauri::command]
fn create_session(
    app: tauri::AppHandle,
    args: CreateSessionArgs,
) -> Result<NotesSessionsSnapshot, String> {
    let state = create_session_state(&app, &args.name)?;
    Ok(sessions_snapshot(&state))
}

#[tauri::command]
fn set_active_session(
    app: tauri::AppHandle,
    args: SetActiveSessionArgs,
) -> Result<NotesSessionsSnapshot, String> {
    let state = set_active_session_state(&app, &args.session_id)?;
    Ok(sessions_snapshot(&state))
}

#[tauri::command]
async fn get_git_status(app: tauri::AppHandle) -> Result<GitSyncStatus, String> {
    tauri::async_runtime::spawn_blocking(move || get_git_status_blocking(app))
        .await
        .map_err(|error| error.to_string())?
}

fn get_git_status_blocking(app: tauri::AppHandle) -> Result<GitSyncStatus, String> {
    let root = notes_root(&app)?;
    ensure_system_folders(&root)?;
    Ok(build_git_status(&root))
}

#[tauri::command]
async fn connect_git_repo(
    app: tauri::AppHandle,
    args: ConnectGitArgs,
) -> Result<GitSyncStatus, String> {
    tauri::async_runtime::spawn_blocking(move || connect_git_repo_blocking(app, args))
        .await
        .map_err(|error| error.to_string())?
}

fn connect_git_repo_blocking(
    app: tauri::AppHandle,
    args: ConnectGitArgs,
) -> Result<GitSyncStatus, String> {
    let root = notes_root(&app)?;
    ensure_system_folders(&root)?;
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
    tauri::async_runtime::spawn_blocking(move || git_pull_blocking(app, args))
        .await
        .map_err(|error| error.to_string())?
}

fn git_pull_blocking(app: tauri::AppHandle, args: GitSyncArgs) -> Result<GitSyncStatus, String> {
    let root = notes_root(&app)?;
    ensure_system_folders(&root)?;
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
    Err("Pull requires a merge commit. Resolve it on desktop, then pull again on mobile.".to_string())
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
        .connect_auth(Direction::Push, Some(build_callbacks(username, password)), None)
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
    tauri::async_runtime::spawn_blocking(move || git_push_blocking(app, args))
        .await
        .map_err(|error| error.to_string())?
}

fn git_push_blocking(app: tauri::AppHandle, args: GitPushArgs) -> Result<GitSyncStatus, String> {
    let root = notes_root(&app)?;
    ensure_system_folders(&root)?;
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
    let root = notes_root(&app)?;
    ensure_system_folders(&root)?;
    build_folder_node(&root, "")
}

#[tauri::command]
fn read_note(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let root = notes_root(&app)?;
    let full_path = resolve_path(&app, &path)?;
    let note_file_path = resolve_recording_note_file(&root, &full_path);
    if note_file_path.exists() {
        let raw = fs::read_to_string(note_file_path).map_err(|err| err.to_string())?;
        let (_, body) = parse_note_front_matter(&raw);
        return Ok(body);
    }
    if full_path.is_dir() && full_path.starts_with(root.join(RECORDINGS_FOLDER)) {
        return Ok(pending_transcript_placeholder(&full_path));
    }
    Err("Note file does not exist.".to_string())
}

#[tauri::command]
fn write_note(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    let root = notes_root(&app)?;
    let full_path = resolve_path(&app, &path)?;
    let note_file_path = resolve_recording_note_file(&root, &full_path);
    if let Some(parent) = note_file_path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let mut meta = if note_file_path.exists() {
        let existing = fs::read_to_string(&note_file_path).map_err(|err| err.to_string())?;
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
    let serialized = render_note_with_front_matter(&meta, &content);
    fs::write(note_file_path, serialized).map_err(|err| err.to_string())
}

#[tauri::command]
fn save_audio_recording(
    app: tauri::AppHandle,
    args: SaveRecordingArgs,
) -> Result<RecordingWriteResult, String> {
    let root = notes_root(&app)?;
    ensure_system_folders(&root)?;
    let recordings_root = root.join(RECORDINGS_FOLDER);
    fs::create_dir_all(&recordings_root).map_err(|error| error.to_string())?;

    let audio_bytes = decode_audio_base64(&args.audio_base64)?;
    if audio_bytes.is_empty() {
        return Err("Audio payload is empty.".to_string());
    }

    let timestamp = now_ms().unwrap_or(0);
    let mut attempt = 0usize;
    let recording_dir = loop {
        let suffix = if attempt == 0 {
            format!("recording-{}", timestamp)
        } else {
            format!("recording-{}-{}", timestamp, attempt)
        };
        let candidate = recordings_root.join(suffix);
        if !candidate.exists() {
            break candidate;
        }
        attempt += 1;
        if attempt > 2048 {
            return Err("Failed to allocate recording folder name.".to_string());
        }
    };

    fs::create_dir_all(&recording_dir).map_err(|error| error.to_string())?;
    let extension = audio_extension_from_mime(args.mime_type.as_deref());
    let audio_file_name = format!("{}.{}", AUDIO_FILE_NAME_PREFIX, extension);
    let audio_path = recording_dir.join(&audio_file_name);
    fs::write(&audio_path, audio_bytes).map_err(|error| error.to_string())?;

    let transcript_path = recording_dir.join(TRANSCRIPT_FILE_NAME);
    let status_path = recording_dir.join(TRANSCRIPTION_STATUS_FILE);
    update_transcription_state(&status_path, &audio_file_name, "pending", None, None)?;

    Ok(RecordingWriteResult {
        recording_folder: strip_root(&root, &recording_dir),
        audio_path: strip_root(&root, &audio_path),
        transcript_path: strip_root(&root, &transcript_path),
        status_path: strip_root(&root, &status_path),
    })
}

#[tauri::command]
fn queue_recording_transcriptions(
    app: tauri::AppHandle,
    args: QueueRecordingsArgs,
) -> Result<RecordingTranscriptionQueueResult, String> {
    let api_key = args.assembly_api_key.trim();
    if api_key.is_empty() {
        return Err("AssemblyAI API key is required.".to_string());
    }

    let root = notes_root(&app)?;
    ensure_system_folders(&root)?;
    let recordings_root = root.join(RECORDINGS_FOLDER);
    fs::create_dir_all(&recordings_root).map_err(|error| error.to_string())?;

    let mut scanned = 0usize;
    let mut skipped = 0usize;
    let mut candidates = Vec::new();

    for entry in fs::read_dir(&recordings_root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let recording_dir = entry.path();
        if !recording_dir.is_dir() {
            continue;
        }

        scanned += 1;
        let Some(audio_path) = find_recording_audio_file(&recording_dir) else {
            skipped += 1;
            continue;
        };
        let transcript_path = recording_dir.join(TRANSCRIPT_FILE_NAME);
        let status_path = recording_dir.join(TRANSCRIPTION_STATUS_FILE);
        let audio_name = audio_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(AUDIO_FILE_NAME_PREFIX)
            .to_string();

        if transcript_path.exists() {
            let _ = update_transcription_state(
                &status_path,
                &audio_name,
                "completed",
                None,
                None,
            );
            skipped += 1;
            continue;
        }

        if let Some(current) = read_transcription_state(&status_path) {
            if matches!(current.status.as_str(), "queued" | "processing") {
                skipped += 1;
                continue;
            }
        }

        update_transcription_state(&status_path, &audio_name, "queued", None, None)?;
        candidates.push(QueuedTranscriptionJob {
            recording_rel: strip_root(&root, &recording_dir),
            audio_path,
            status_path,
            transcript_path,
            api_key: api_key.to_string(),
        });
    }

    let queued = {
        let queue = transcription_queue_state();
        let mut state = queue.lock().expect("transcription queue poisoned");
        let mut added = 0usize;
        for job in candidates {
            if state.known_recordings.contains(&job.recording_rel) {
                continue;
            }
            state.known_recordings.insert(job.recording_rel.clone());
            state.pending.push_back(job);
            added += 1;
        }
        added
    };

    spawn_transcription_worker_if_needed();

    let in_flight = {
        let queue = transcription_queue_state();
        let state = queue.lock().expect("transcription queue poisoned");
        state.pending.len() + usize::from(state.running)
    };

    Ok(RecordingTranscriptionQueueResult {
        scanned,
        queued,
        skipped,
        in_flight,
    })
}

#[tauri::command]
fn list_recordings(app: tauri::AppHandle) -> Result<RecordingsListResult, String> {
    let root = notes_root(&app)?;
    ensure_system_folders(&root)?;
    let recordings_root = root.join(RECORDINGS_FOLDER);
    fs::create_dir_all(&recordings_root).map_err(|error| error.to_string())?;

    let (queue_running, current_recording, pending, in_flight) = {
        let queue = transcription_queue_state();
        let state = queue.lock().expect("transcription queue poisoned");
        let pending = state
            .pending
            .iter()
            .map(|job| job.recording_rel.clone())
            .collect::<Vec<_>>();
        (
            state.running,
            state.current_recording.clone(),
            pending,
            state.pending.len() + usize::from(state.running),
        )
    };

    let mut recordings = Vec::new();
    for entry in fs::read_dir(&recordings_root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let recording_dir = entry.path();
        if !recording_dir.is_dir() {
            continue;
        }

        let recording_rel = strip_root(&root, &recording_dir);
        let transcript_path = recording_dir.join(TRANSCRIPT_FILE_NAME);
        let status_path = recording_dir.join(TRANSCRIPTION_STATUS_FILE);
        let audio_path = find_recording_audio_file(&recording_dir);
        let state = read_transcription_state(&status_path);

        let default_audio_name = audio_path
            .as_ref()
            .and_then(|path| path.file_name())
            .and_then(|value| value.to_str())
            .unwrap_or(AUDIO_FILE_NAME_PREFIX)
            .to_string();
        let status = if transcript_path.exists() {
            "completed".to_string()
        } else {
            state
                .as_ref()
                .map(|value| value.status.clone())
                .unwrap_or_else(|| "pending".to_string())
        };

        recordings.push(RecordingListItem {
            recording_folder: recording_rel.clone(),
            audio_path: audio_path.as_ref().map(|path| strip_root(&root, path)),
            transcript_path: strip_root(&root, &transcript_path),
            status_path: strip_root(&root, &status_path),
            status,
            error: state.as_ref().and_then(|value| value.error.clone()),
            updated_ms: state.as_ref().and_then(|value| value.updated_ms),
            is_queued: pending.iter().any(|value| value == &recording_rel),
            is_processing: current_recording.as_deref() == Some(recording_rel.as_str()),
        });

        if state.is_none() && audio_path.is_some() {
            let _ = update_transcription_state(
                &status_path,
                &default_audio_name,
                "pending",
                None,
                None,
            );
        }
    }

    recordings.sort_by(|a, b| b.updated_ms.unwrap_or(0).cmp(&a.updated_ms.unwrap_or(0)));

    Ok(RecordingsListResult {
        queue: RecordingQueueSnapshot {
            running: queue_running,
            current_recording,
            pending,
            in_flight,
        },
        recordings,
    })
}

#[tauri::command]
fn read_recording_audio(
    app: tauri::AppHandle,
    args: ReadRecordingAudioArgs,
) -> Result<RecordingAudioPayload, String> {
    let root = notes_root(&app)?;
    ensure_system_folders(&root)?;
    let recordings_root = root.join(RECORDINGS_FOLDER);
    let path_rel = sanitize_relative(&args.path)?;
    let audio_path = root.join(path_rel);
    if !audio_path.starts_with(&recordings_root) {
        return Err("Only files inside Recordings are allowed.".to_string());
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

fn time_to_ms(time: std::time::SystemTime) -> Option<i64> {
    let duration = time.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(duration.as_millis()).ok()
}

#[tauri::command]
fn get_note_meta(app: tauri::AppHandle, path: String) -> Result<NoteMeta, String> {
    let root = notes_root(&app)?;
    let full_path = resolve_path(&app, &path)?;
    let note_file_path = resolve_recording_note_file(&root, &full_path);
    let (front_matter_meta, metadata) = if note_file_path.exists() {
        let raw = fs::read_to_string(&note_file_path).map_err(|err| err.to_string())?;
        let (front_matter_meta, _) = parse_note_front_matter(&raw);
        (
            front_matter_meta,
            fs::metadata(&note_file_path).map_err(|err| err.to_string())?,
        )
    } else {
        (
            NoteFrontMatter::default(),
            fs::metadata(full_path).map_err(|err| err.to_string())?,
        )
    };
    let note_rel = strip_root(&root, &note_file_path);
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
    })
}

#[tauri::command]
fn move_items(
    app: tauri::AppHandle,
    items: Vec<String>,
    destination: String,
) -> Result<(), String> {
    let root = notes_root(&app)?;
    ensure_system_folders(&root)?;
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
    let root = notes_root(&app)?;
    ensure_system_folders(&root)?;
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
    let root = notes_root(&app)?;
    ensure_system_folders(&root)?;
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
    let parent_path = resolve_path(&app, &args.parent)?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = apply_macos_window_alpha(&window, MACOS_WINDOW_ALPHA);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_tree,
            read_note,
            get_note_meta,
            write_note,
            save_audio_recording,
            queue_recording_transcriptions,
            list_recordings,
            read_recording_audio,
            move_items,
            delete_items,
            rename_item,
            set_order,
            get_sessions,
            create_session,
            set_active_session,
            get_git_status,
            connect_git_repo,
            git_pull,
            git_push
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
