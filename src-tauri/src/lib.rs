use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use git2::{
    build::CheckoutBuilder, AnnotatedCommit, Cred, CredentialType, Direction, FetchOptions,
    IndexAddOption, Oid, PushOptions, RemoteCallbacks, Repository, ResetType, Signature, Sort,
    StatusOptions,
};
#[cfg(target_os = "ios")]
use objc::declare::ClassDecl;
#[cfg(target_os = "ios")]
use objc::runtime::{Class, Object, Protocol, Sel, BOOL, NO, YES};
#[cfg(target_os = "ios")]
use objc::{msg_send, sel, sel_impl};
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
#[cfg(target_os = "ios")]
use std::{
    ffi::{CStr, CString},
    os::raw::{c_char, c_int},
    ptr,
};
use tauri::Manager;
use uuid::Uuid;

const ORDER_FILE: &str = ".notes-order.json";
const PROFILES_FILE: &str = ".notes-profiles.json";
const LEGACY_PROFILES_FILE: &str = ".notes-sessions.json";
const FEED_FOLDER: &str = "Feed";
const LEGACY_UNSORTED_FOLDER: &str = "Unsorted";
const ARCHIEVE_FOLDER: &str = "Archieve";
const RECORDINGS_STORAGE_FOLDER: &str = "Recordings";
const LEGACY_RECORDINGS_FOLDER: &str = "_Recordings";
const AUDIO_FILE_NAME_PREFIX: &str = "audio";
const RECORDING_FRONTMATTER_TYPE: &str = "audio_recording";
const RECORDING_STATUS_PENDING: &str = "pending";
const RECORDING_STATUS_QUEUED: &str = "queued";
const RECORDING_STATUS_PROCESSING: &str = "processing";
const RECORDING_STATUS_COMPLETED: &str = "completed";
const RECORDING_STATUS_FAILED: &str = "failed";
const TRANSCRIPT_START_MARKER: &str = "<!-- recording-transcript:start -->";
const TRANSCRIPT_END_MARKER: &str = "<!-- recording-transcript:end -->";
const ASSEMBLY_UPLOAD_URL: &str = "https://api.assemblyai.com/v2/upload";
const ASSEMBLY_TRANSCRIPT_URL: &str = "https://api.assemblyai.com/v2/transcript";
const ASSEMBLY_SPEECH_MODEL: &str = "universal-2";
const ASSEMBLY_POLL_INTERVAL: Duration = Duration::from_secs(2);
const ASSEMBLY_MAX_POLL_ATTEMPTS: usize = 180;
const VISIBLE_SYSTEM_FOLDERS: [&str; 2] = [FEED_FOLDER, ARCHIEVE_FOLDER];
const REQUIRED_SYSTEM_FOLDERS: [&str; 3] =
    [FEED_FOLDER, ARCHIEVE_FOLDER, RECORDINGS_STORAGE_FOLDER];
const PROTECTED_SYSTEM_FOLDERS: [&str; 5] = [
    FEED_FOLDER,
    ARCHIEVE_FOLDER,
    LEGACY_UNSORTED_FOLDER,
    RECORDINGS_STORAGE_FOLDER,
    LEGACY_RECORDINGS_FOLDER,
];
const HIDDEN_ROOT_FOLDERS: [&str; 2] = [RECORDINGS_STORAGE_FOLDER, LEGACY_RECORDINGS_FOLDER];
#[cfg(target_os = "macos")]
const MACOS_WINDOW_ALPHA: f64 = 1.0;

#[cfg(target_os = "macos")]
fn apply_macos_window_alpha(window: &tauri::WebviewWindow, alpha: f64) -> tauri::Result<()> {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};

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
    note_type: Option<String>,
    recording_audio_path: Option<String>,
    transcription_status: Option<String>,
    transcription_error: Option<String>,
    transcription_updated_ms: Option<i64>,
    transcription_id: Option<String>,
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

#[derive(Deserialize)]
struct SetNoteTimestampArgs {
    path: String,
    timestamp_ms: i64,
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

#[derive(Serialize)]
struct GitCommitHistoryEntry {
    id: String,
    short_id: String,
    summary: String,
    author: String,
    authored_ms: Option<i64>,
    sync_state: String,
    is_head: bool,
}

#[derive(Deserialize)]
struct GitHistoryArgs {
    limit: Option<usize>,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
struct NotesProfileEntry {
    id: String,
    name: String,
    notes_root: String,
}

#[derive(Clone, Default, Deserialize, PartialEq, Serialize)]
struct NotesProfilesFile {
    #[serde(default, alias = "active_session_id")]
    active_profile_id: String,
    #[serde(default, alias = "sessions")]
    profiles: Vec<NotesProfileEntry>,
}

#[derive(Serialize)]
struct NotesProfilesSnapshot {
    active_profile_id: String,
    profiles: Vec<NotesProfileEntry>,
}

#[derive(Deserialize)]
struct CreateProfileArgs {
    name: String,
}

#[derive(Deserialize)]
struct SetActiveProfileArgs {
    profile_id: String,
}

#[derive(Deserialize)]
struct SetProfileNotesRootArgs {
    profile_id: String,
    notes_root: String,
}

#[derive(Deserialize)]
struct CreateNoteArgs {
    folder_path: Option<String>,
    content: Option<String>,
    timestamp_ms: Option<i64>,
}

#[derive(Serialize)]
struct CreateNoteResult {
    path: String,
}

#[derive(Deserialize)]
struct SaveRecordingArgs {
    audio_base64: String,
    mime_type: Option<String>,
    folder_path: Option<String>,
}

#[derive(Serialize)]
struct RecordingWriteResult {
    folder_path: String,
    note_path: String,
    audio_path: String,
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
    note_path: String,
    folder_path: String,
    audio_path: Option<String>,
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

#[derive(Serialize)]
struct NativeRecorderCapabilities {
    supported: bool,
    recording: bool,
    started_ms: Option<i64>,
}

#[cfg(target_os = "ios")]
struct IosNativeRecorderState {
    recorder_ptr: usize,
    output_path: PathBuf,
    mime_type: String,
    started_ms: Option<i64>,
}

#[derive(Clone)]
struct QueuedTranscriptionJob {
    note_rel: String,
    note_path: PathBuf,
    audio_path: PathBuf,
    api_key: String,
}

#[derive(Clone)]
struct RecordingNoteInfo {
    note_rel: String,
    note_path: PathBuf,
    audio_rel: String,
    audio_path: PathBuf,
    status: String,
    error: Option<String>,
    updated_ms: Option<i64>,
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
#[cfg(target_os = "ios")]
static IOS_NATIVE_RECORDER: OnceLock<Mutex<Option<IosNativeRecorderState>>> = OnceLock::new();
#[cfg(target_os = "ios")]
static IOS_WEBVIEW_TERMINATION_PROXIES: OnceLock<Mutex<HashMap<usize, usize>>> = OnceLock::new();
#[cfg(target_os = "ios")]
static IOS_WEBVIEW_TERMINATION_PROXY_CLASS_PTR: OnceLock<usize> = OnceLock::new();

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_data_dir().map_err(|err| err.to_string())?;
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|err| err.to_string())?;
    }
    Ok(path)
}

fn profiles_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(PROFILES_FILE))
}

fn legacy_profiles_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(LEGACY_PROFILES_FILE))
}

fn profile_root_for_id(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("profiles").join(id).join("notes"))
}

fn is_directory_empty(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(true);
    }
    let mut entries = fs::read_dir(path).map_err(|err| err.to_string())?;
    Ok(entries.next().is_none())
}

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
    if !to.exists() {
        fs::create_dir_all(to).map_err(|err| err.to_string())?;
    }
    for entry in fs::read_dir(from).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        let metadata = entry.metadata().map_err(|err| err.to_string())?;
        if metadata.is_dir() {
            copy_dir_recursive(&source, &target)?;
        } else if metadata.is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
            fs::copy(&source, &target).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn move_dir_contents(source: &Path, destination: &Path) -> Result<(), String> {
    if source == destination {
        return Ok(());
    }
    if !source.exists() {
        fs::create_dir_all(destination).map_err(|err| err.to_string())?;
        return Ok(());
    }
    if destination.exists() {
        if !is_directory_empty(destination)? {
            return Err(format!(
                "Destination is not empty: {}",
                destination.to_string_lossy()
            ));
        }
    } else if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    if let Err(rename_error) = fs::rename(source, destination) {
        copy_dir_recursive(source, destination)?;
        fs::remove_dir_all(source).map_err(|err| {
            format!(
                "Failed to remove source after copy ({}): {}",
                source.to_string_lossy(),
                err
            )
        })?;
        println!(
            "[profiles] fallback copy used while moving profile root (rename failed: {})",
            rename_error
        );
    }
    Ok(())
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

fn normalize_profile_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        "Profile".to_string()
    } else {
        trimmed.to_string()
    }
}

fn slugify_profile_id(name: &str) -> String {
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
        "profile".to_string()
    } else {
        compact
    }
}

fn default_profiles_state(app: &tauri::AppHandle) -> Result<NotesProfilesFile, String> {
    let legacy_root = legacy_notes_root(app)?;
    if !legacy_root.exists() {
        fs::create_dir_all(&legacy_root).map_err(|err| err.to_string())?;
    }
    Ok(NotesProfilesFile {
        active_profile_id: "default".to_string(),
        profiles: vec![NotesProfileEntry {
            id: "default".to_string(),
            name: "Default".to_string(),
            notes_root: legacy_root.to_string_lossy().to_string(),
        }],
    })
}

fn write_profiles_state(app: &tauri::AppHandle, state: &NotesProfilesFile) -> Result<(), String> {
    let path = profiles_file_path(app)?;
    let content = serde_json::to_string_pretty(state).map_err(|err| err.to_string())?;
    fs::write(path, content).map_err(|err| err.to_string())
}

fn normalize_profiles_state(
    app: &tauri::AppHandle,
    mut state: NotesProfilesFile,
) -> Result<NotesProfilesFile, String> {
    let mut seen = HashSet::new();
    let mut profiles = Vec::new();
    for mut profile in state.profiles.drain(..) {
        let id = profile.id.trim().to_string();
        if id.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        profile.id = id.clone();
        profile.name = normalize_profile_name(&profile.name);
        if profile.notes_root.trim().is_empty() {
            profile.notes_root = profile_root_for_id(app, &id)?.to_string_lossy().to_string();
        }
        let root = PathBuf::from(&profile.notes_root);
        if !root.exists() {
            fs::create_dir_all(&root).map_err(|err| err.to_string())?;
        }
        profiles.push(profile);
    }

    if profiles.is_empty() {
        return default_profiles_state(app);
    }

    let active_profile_id = if profiles
        .iter()
        .any(|profile| profile.id == state.active_profile_id)
    {
        state.active_profile_id
    } else {
        profiles[0].id.clone()
    };

    Ok(NotesProfilesFile {
        active_profile_id,
        profiles,
    })
}

fn ensure_profiles_state(app: &tauri::AppHandle) -> Result<NotesProfilesFile, String> {
    let path = profiles_file_path(app)?;
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
        return match serde_json::from_str::<NotesProfilesFile>(&content) {
            Ok(parsed) => {
                let normalized = normalize_profiles_state(app, parsed.clone())?;
                if normalized != parsed {
                    write_profiles_state(app, &normalized)?;
                }
                Ok(normalized)
            }
            Err(_) => {
                let state = default_profiles_state(app)?;
                write_profiles_state(app, &state)?;
                Ok(state)
            }
        };
    }

    let legacy_path = legacy_profiles_file_path(app)?;
    if legacy_path.exists() {
        let content = fs::read_to_string(&legacy_path).map_err(|err| err.to_string())?;
        if let Ok(parsed) = serde_json::from_str::<NotesProfilesFile>(&content) {
            let normalized = normalize_profiles_state(app, parsed)?;
            write_profiles_state(app, &normalized)?;
            return Ok(normalized);
        }
    }

    let state = default_profiles_state(app)?;
    write_profiles_state(app, &state)?;
    Ok(state)
}

fn profiles_snapshot(state: &NotesProfilesFile) -> NotesProfilesSnapshot {
    NotesProfilesSnapshot {
        active_profile_id: state.active_profile_id.clone(),
        profiles: state.profiles.clone(),
    }
}

fn find_profile<'a>(
    state: &'a NotesProfilesFile,
    profile_id: &str,
) -> Option<&'a NotesProfileEntry> {
    state
        .profiles
        .iter()
        .find(|profile| profile.id == profile_id)
}

fn set_active_profile_state(
    app: &tauri::AppHandle,
    profile_id: &str,
) -> Result<NotesProfilesFile, String> {
    let mut state = ensure_profiles_state(app)?;
    let id = profile_id.trim();
    if id.is_empty() {
        return Err("Profile id is required.".to_string());
    }
    if find_profile(&state, id).is_none() {
        return Err(format!("Profile not found: {}", id));
    }
    state.active_profile_id = id.to_string();
    write_profiles_state(app, &state)?;
    Ok(state)
}

fn create_profile_state(app: &tauri::AppHandle, name: &str) -> Result<NotesProfilesFile, String> {
    let mut state = ensure_profiles_state(app)?;
    let profile_name = normalize_profile_name(name);
    let base_id = slugify_profile_id(&profile_name);
    let existing: HashSet<String> = state
        .profiles
        .iter()
        .map(|profile| profile.id.clone())
        .collect();
    let mut profile_id = base_id.clone();
    let mut suffix = 2usize;
    while existing.contains(&profile_id) {
        profile_id = format!("{}-{}", base_id, suffix);
        suffix += 1;
    }

    let profile_root = profile_root_for_id(app, &profile_id)?;
    if !profile_root.exists() {
        fs::create_dir_all(&profile_root).map_err(|err| err.to_string())?;
    }

    state.profiles.push(NotesProfileEntry {
        id: profile_id.clone(),
        name: profile_name,
        notes_root: profile_root.to_string_lossy().to_string(),
    });
    state.active_profile_id = profile_id;
    write_profiles_state(app, &state)?;
    Ok(state)
}

fn normalize_notes_root_path(notes_root: &str) -> Result<PathBuf, String> {
    let trimmed = notes_root.trim();
    if trimmed.is_empty() {
        return Err("Profile notes root is required.".to_string());
    }
    let candidate = PathBuf::from(trimmed);
    if !candidate.is_absolute() {
        return Err("Profile notes root must be an absolute path.".to_string());
    }
    Ok(candidate)
}

fn set_profile_notes_root_state(
    app: &tauri::AppHandle,
    profile_id: &str,
    notes_root: &str,
) -> Result<NotesProfilesFile, String> {
    let mut state = ensure_profiles_state(app)?;
    let id = profile_id.trim();
    if id.is_empty() {
        return Err("Profile id is required.".to_string());
    }
    let next_root = normalize_notes_root_path(notes_root)?;
    let Some(index) = state.profiles.iter().position(|profile| profile.id == id) else {
        return Err(format!("Profile not found: {}", id));
    };

    let current_root = PathBuf::from(state.profiles[index].notes_root.trim());
    if current_root != next_root {
        move_dir_contents(&current_root, &next_root)?;
    } else if !next_root.exists() {
        fs::create_dir_all(&next_root).map_err(|err| err.to_string())?;
    }
    ensure_system_folders(&next_root)?;

    state.profiles[index].notes_root = next_root.to_string_lossy().to_string();
    write_profiles_state(app, &state)?;
    Ok(state)
}

fn notes_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = match ensure_profiles_state(app) {
        Ok(state) => {
            let active = find_profile(&state, &state.active_profile_id)
                .or_else(|| state.profiles.first())
                .ok_or_else(|| "No profiles configured.".to_string())?;
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

#[cfg(target_os = "ios")]
fn ios_native_recorder_state() -> &'static Mutex<Option<IosNativeRecorderState>> {
    IOS_NATIVE_RECORDER.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "ios")]
const IOS_WEBVIEW_TERMINATION_PROXY_CLASS: &str = "TypeWebViewTerminationProxy";
#[cfg(target_os = "ios")]
const IOS_WEBVIEW_RELOAD_THROTTLE_MS: i64 = 1_000;
#[cfg(target_os = "ios")]
const IOS_AUDIO_MIME_TYPE: &str = "audio/mp4";
#[cfg(target_os = "ios")]
const IOS_AUDIO_FILE_EXT: &str = "m4a";
#[cfg(target_os = "ios")]
const K_AUDIO_FORMAT_MPEG4AAC: u32 = 0x6161_6320;
#[cfg(target_os = "ios")]
const RTLD_NOW: c_int = 2;

#[cfg(target_os = "ios")]
unsafe extern "C" {
    fn dlopen(filename: *const c_char, flag: c_int) -> *mut core::ffi::c_void;
    fn dlerror() -> *const c_char;
}

#[cfg(target_os = "ios")]
fn ios_webview_termination_proxies() -> &'static Mutex<HashMap<usize, usize>> {
    IOS_WEBVIEW_TERMINATION_PROXIES.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(target_os = "ios")]
fn ios_webview_termination_proxy_class() -> &'static Class {
    let class_ptr = IOS_WEBVIEW_TERMINATION_PROXY_CLASS_PTR.get_or_init(|| {
        if let Some(existing) = Class::get(IOS_WEBVIEW_TERMINATION_PROXY_CLASS) {
            return existing as *const Class as usize;
        }

        let superclass = Class::get("NSObject")
            .expect("NSObject missing while installing iOS webview termination proxy");
        let mut decl = ClassDecl::new(IOS_WEBVIEW_TERMINATION_PROXY_CLASS, superclass)
            .expect("Failed to declare iOS webview termination proxy class");
        if let Some(protocol) = Protocol::get("WKNavigationDelegate") {
            decl.add_protocol(protocol);
        }
        decl.add_ivar::<*mut Object>("originalDelegate");
        decl.add_ivar::<i64>("lastReloadMs");
        unsafe {
            decl.add_method(
                sel!(dealloc),
                ios_webview_termination_proxy_dealloc as extern "C" fn(&mut Object, Sel),
            );
            decl.add_method(
                sel!(respondsToSelector:),
                ios_webview_termination_proxy_responds_to_selector
                    as extern "C" fn(&Object, Sel, Sel) -> BOOL,
            );
            decl.add_method(
                sel!(forwardingTargetForSelector:),
                ios_webview_termination_proxy_forwarding_target_for_selector
                    as extern "C" fn(&Object, Sel, Sel) -> *mut Object,
            );
            decl.add_method(
                sel!(webViewWebContentProcessDidTerminate:),
                ios_webview_termination_proxy_process_did_terminate
                    as extern "C" fn(&mut Object, Sel, *mut Object),
            );
        }

        decl.register() as *const Class as usize
    });

    unsafe { &*(*class_ptr as *const Class) }
}

#[cfg(target_os = "ios")]
extern "C" fn ios_webview_termination_proxy_dealloc(this: &mut Object, _cmd: Sel) {
    unsafe {
        let original_delegate = *this.get_ivar::<*mut Object>("originalDelegate");
        if !original_delegate.is_null() {
            let _: () = msg_send![original_delegate, release];
            this.set_ivar("originalDelegate", ptr::null_mut::<Object>());
        }

        let superclass = this
            .class()
            .superclass()
            .expect("iOS webview termination proxy superclass missing");
        let _: () = msg_send![super(this, superclass), dealloc];
    }
}

#[cfg(target_os = "ios")]
extern "C" fn ios_webview_termination_proxy_responds_to_selector(
    this: &Object,
    _cmd: Sel,
    selector: Sel,
) -> BOOL {
    unsafe {
        if selector == sel!(webViewWebContentProcessDidTerminate:) {
            return YES;
        }

        let original_delegate = *this.get_ivar::<*mut Object>("originalDelegate");
        if !original_delegate.is_null() {
            let responds: BOOL = msg_send![original_delegate, respondsToSelector: selector];
            if responds == YES {
                return YES;
            }
        }

        let superclass = this
            .class()
            .superclass()
            .expect("iOS webview termination proxy superclass missing");
        msg_send![super(this, superclass), respondsToSelector: selector]
    }
}

#[cfg(target_os = "ios")]
extern "C" fn ios_webview_termination_proxy_forwarding_target_for_selector(
    this: &Object,
    _cmd: Sel,
    selector: Sel,
) -> *mut Object {
    unsafe {
        if selector == sel!(webViewWebContentProcessDidTerminate:) {
            return ptr::null_mut();
        }

        let original_delegate = *this.get_ivar::<*mut Object>("originalDelegate");
        if !original_delegate.is_null() {
            let responds: BOOL = msg_send![original_delegate, respondsToSelector: selector];
            if responds == YES {
                return original_delegate;
            }
        }

        let superclass = this
            .class()
            .superclass()
            .expect("iOS webview termination proxy superclass missing");
        msg_send![super(this, superclass), forwardingTargetForSelector: selector]
    }
}

#[cfg(target_os = "ios")]
extern "C" fn ios_webview_termination_proxy_process_did_terminate(
    this: &mut Object,
    _cmd: Sel,
    webview: *mut Object,
) {
    unsafe {
        if webview.is_null() {
            return;
        }

        let now = now_ms().unwrap_or(0);
        let last_reload_ms = *this.get_ivar::<i64>("lastReloadMs");
        let should_reload =
            now <= 0 || now.saturating_sub(last_reload_ms) >= IOS_WEBVIEW_RELOAD_THROTTLE_MS;
        if should_reload {
            if now > 0 {
                this.set_ivar("lastReloadMs", now);
            }
            let _: () = msg_send![webview, reload];
            println!("[ios] WKWebView content process terminated. Reload requested.");
        }

        let original_delegate = *this.get_ivar::<*mut Object>("originalDelegate");
        if !original_delegate.is_null() {
            let responds: BOOL = msg_send![
                original_delegate,
                respondsToSelector: sel!(webViewWebContentProcessDidTerminate:)
            ];
            if responds == YES {
                let _: () = msg_send![
                    original_delegate,
                    webViewWebContentProcessDidTerminate: webview
                ];
            }
        }
    }
}

#[cfg(target_os = "ios")]
unsafe fn install_ios_webview_termination_recovery_for_webview(
    webview: *mut Object,
) -> Result<(), String> {
    if webview.is_null() {
        return Err("WKWebView handle is null.".to_string());
    }

    let proxy_class = ios_webview_termination_proxy_class();
    let current_delegate: *mut Object = msg_send![webview, navigationDelegate];
    if !current_delegate.is_null() {
        let delegate_class: *const Class = msg_send![current_delegate, class];
        if std::ptr::eq(delegate_class, proxy_class as *const Class) {
            return Ok(());
        }
    }

    let proxy_alloc: *mut Object = msg_send![proxy_class, alloc];
    if proxy_alloc.is_null() {
        return Err("Failed to allocate iOS webview termination proxy.".to_string());
    }
    let proxy: *mut Object = msg_send![proxy_alloc, init];
    if proxy.is_null() {
        return Err("Failed to initialize iOS webview termination proxy.".to_string());
    }

    if !current_delegate.is_null() {
        let _: *mut Object = msg_send![current_delegate, retain];
    }
    (*proxy).set_ivar("originalDelegate", current_delegate);
    (*proxy).set_ivar("lastReloadMs", 0_i64);

    // WKWebView.navigationDelegate is weak, so keep the proxy alive.
    let _: *mut Object = msg_send![proxy, retain];
    let _: () = msg_send![webview, setNavigationDelegate: proxy];

    let mut proxies = ios_webview_termination_proxies()
        .lock()
        .map_err(|_| "Failed to lock iOS webview proxy registry.".to_string())?;
    if let Some(previous_proxy_addr) = proxies.insert(webview as usize, proxy as usize) {
        if previous_proxy_addr != proxy as usize {
            let previous_proxy = previous_proxy_addr as *mut Object;
            if !previous_proxy.is_null() {
                let _: () = msg_send![previous_proxy, release];
            }
        }
    }

    Ok(())
}

#[cfg(target_os = "ios")]
fn install_ios_webview_termination_recovery(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if let Err(error) = window.with_webview(|platform_webview| unsafe {
        let webview = platform_webview.inner() as *mut Object;
        if let Err(error) = install_ios_webview_termination_recovery_for_webview(webview) {
            println!(
                "[ios] Failed to install WKWebView termination recovery: {}",
                error
            );
        }
    }) {
        println!(
            "[ios] Failed to access WKWebView for termination recovery: {}",
            error
        );
    }
}

#[cfg(target_os = "ios")]
fn release_ios_webview_termination_proxies() {
    let Some(proxies) = IOS_WEBVIEW_TERMINATION_PROXIES.get() else {
        return;
    };
    let mut proxies = match proxies.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    for (_, proxy_addr) in proxies.drain() {
        let proxy = proxy_addr as *mut Object;
        if proxy.is_null() {
            continue;
        }
        unsafe {
            let _: () = msg_send![proxy, release];
        }
    }
}

#[cfg(target_os = "ios")]
fn ensure_avfoundation_loaded() -> Result<(), String> {
    let framework_path =
        CString::new("/System/Library/Frameworks/AVFoundation.framework/AVFoundation")
            .map_err(|_| "Failed to load AVFoundation framework path.".to_string())?;
    unsafe {
        let handle = dlopen(framework_path.as_ptr(), RTLD_NOW);
        if !handle.is_null() {
            return Ok(());
        }
        let error_ptr = dlerror();
        if error_ptr.is_null() {
            return Err("Failed to load AVFoundation framework.".to_string());
        }
        let message = CStr::from_ptr(error_ptr).to_string_lossy().to_string();
        Err(format!(
            "Failed to load AVFoundation framework: {}",
            message
        ))
    }
}

#[cfg(target_os = "ios")]
fn ns_class(name: &str) -> Result<&'static Class, String> {
    Class::get(name).ok_or_else(|| format!("Missing iOS runtime class: {}", name))
}

#[cfg(target_os = "ios")]
fn ns_string(value: &str) -> Result<*mut Object, String> {
    let c_value =
        CString::new(value).map_err(|_| "Failed to convert string for iOS runtime.".to_string())?;
    unsafe {
        let class = ns_class("NSString")?;
        let result: *mut Object = msg_send![class, stringWithUTF8String: c_value.as_ptr()];
        if result.is_null() {
            return Err("Failed to create NSString.".to_string());
        }
        Ok(result)
    }
}

#[cfg(target_os = "ios")]
fn ns_error_message(error: *mut Object, fallback: &str) -> String {
    if error.is_null() {
        return fallback.to_string();
    }
    unsafe {
        let localized: *mut Object = msg_send![error, localizedDescription];
        if localized.is_null() {
            return fallback.to_string();
        }
        let c_message: *const c_char = msg_send![localized, UTF8String];
        if c_message.is_null() {
            return fallback.to_string();
        }
        CStr::from_ptr(c_message).to_string_lossy().to_string()
    }
}

#[cfg(target_os = "ios")]
fn configure_ios_audio_for_recording() -> Result<(), String> {
    unsafe {
        let av_audio_class = ns_class("AVAudioSession")?;
        let av_audio: *mut Object = msg_send![av_audio_class, sharedInstance];
        if av_audio.is_null() {
            return Err("Failed to access AVAudioSession.".to_string());
        }
        let category = ns_string("AVAudioSessionCategoryPlayAndRecord")?;
        let mut error: *mut Object = ptr::null_mut();
        let category_ok: BOOL = msg_send![av_audio, setCategory: category error: &mut error];
        if category_ok == NO {
            return Err(ns_error_message(
                error,
                "Failed to set AVAudioSession category.",
            ));
        }
        let active_ok: BOOL = msg_send![av_audio, setActive: YES error: &mut error];
        if active_ok == NO {
            return Err(ns_error_message(
                error,
                "Failed to activate AVAudioSession.",
            ));
        }
    }
    Ok(())
}

#[cfg(target_os = "ios")]
fn deactivate_ios_audio() {
    unsafe {
        if let Some(av_audio_class) = Class::get("AVAudioSession") {
            let av_audio: *mut Object = msg_send![av_audio_class, sharedInstance];
            if av_audio.is_null() {
                return;
            }
            let mut error: *mut Object = ptr::null_mut();
            let _: BOOL = msg_send![av_audio, setActive: NO error: &mut error];
        }
    }
}

#[cfg(target_os = "ios")]
fn create_ios_audio_recorder(output_path: &Path) -> Result<*mut Object, String> {
    unsafe {
        let dictionary_class = ns_class("NSMutableDictionary")?;
        let settings: *mut Object = msg_send![dictionary_class, dictionary];
        if settings.is_null() {
            return Err("Failed to create recorder settings.".to_string());
        }

        let number_class = ns_class("NSNumber")?;
        let format_key = ns_string("AVFormatIDKey")?;
        let sample_rate_key = ns_string("AVSampleRateKey")?;
        let channels_key = ns_string("AVNumberOfChannelsKey")?;
        let bitrate_key = ns_string("AVEncoderBitRateKey")?;
        let quality_key = ns_string("AVEncoderAudioQualityKey")?;

        let format_value: *mut Object =
            msg_send![number_class, numberWithUnsignedInt: K_AUDIO_FORMAT_MPEG4AAC];
        let sample_rate_value: *mut Object = msg_send![number_class, numberWithDouble: 44_100.0f64];
        let channels_value: *mut Object = msg_send![number_class, numberWithInt: 1i32];
        let bitrate_value: *mut Object = msg_send![number_class, numberWithInt: 128_000i32];
        let quality_value: *mut Object = msg_send![number_class, numberWithInt: 96i32];

        let _: () = msg_send![settings, setObject: format_value forKey: format_key];
        let _: () = msg_send![settings, setObject: sample_rate_value forKey: sample_rate_key];
        let _: () = msg_send![settings, setObject: channels_value forKey: channels_key];
        let _: () = msg_send![settings, setObject: bitrate_value forKey: bitrate_key];
        let _: () = msg_send![settings, setObject: quality_value forKey: quality_key];

        let path_ns = ns_string(&output_path.to_string_lossy())?;
        let url_class = ns_class("NSURL")?;
        let url: *mut Object = msg_send![url_class, fileURLWithPath: path_ns];
        if url.is_null() {
            return Err("Failed to build native recorder output URL.".to_string());
        }

        let recorder_class = ns_class("AVAudioRecorder")?;
        let alloc: *mut Object = msg_send![recorder_class, alloc];
        if alloc.is_null() {
            return Err("Failed to allocate AVAudioRecorder.".to_string());
        }
        let mut error: *mut Object = ptr::null_mut();
        let recorder: *mut Object =
            msg_send![alloc, initWithURL: url settings: settings error: &mut error];
        if recorder.is_null() {
            return Err(ns_error_message(
                error,
                "Failed to initialize AVAudioRecorder.",
            ));
        }

        let prepared: BOOL = msg_send![recorder, prepareToRecord];
        if prepared == NO {
            let _: () = msg_send![recorder, release];
            return Err("Failed to prepare AVAudioRecorder.".to_string());
        }
        let started: BOOL = msg_send![recorder, record];
        if started == NO {
            let _: () = msg_send![recorder, release];
            return Err("Failed to start AVAudioRecorder.".to_string());
        }
        Ok(recorder)
    }
}

#[cfg(target_os = "ios")]
fn ios_recorder_is_recording(recorder: *mut Object) -> bool {
    if recorder.is_null() {
        return false;
    }
    unsafe {
        let recording: BOOL = msg_send![recorder, isRecording];
        recording == YES
    }
}

#[cfg(target_os = "ios")]
fn ios_ensure_recorder_active(recorder: *mut Object) -> bool {
    if ios_recorder_is_recording(recorder) {
        return true;
    }
    if configure_ios_audio_for_recording().is_err() {
        return false;
    }
    unsafe {
        let resumed: BOOL = msg_send![recorder, record];
        resumed == YES
    }
}

#[cfg(target_os = "ios")]
fn next_native_recording_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app_data_dir(app)?.join("native-recordings");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let timestamp = now_ms().unwrap_or(0);
    for attempt in 0..=512usize {
        let suffix = if attempt == 0 {
            format!("recording-{}", timestamp)
        } else {
            format!("recording-{}-{}", timestamp, attempt)
        };
        let path = root.join(format!("{}.{}", suffix, IOS_AUDIO_FILE_EXT));
        if !path.exists() {
            return Ok(path);
        }
    }
    Err("Failed to allocate native recording filename.".to_string())
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
            "type" => {
                if !value.is_empty() {
                    meta.note_type = Some(value);
                }
            }
            "recording_audio_path" => {
                if !value.is_empty() {
                    meta.recording_audio_path = Some(value);
                }
            }
            "transcription_status" => {
                if !value.is_empty() {
                    meta.transcription_status = Some(value);
                }
            }
            "transcription_error" => {
                if !value.is_empty() {
                    meta.transcription_error = Some(value);
                }
            }
            "transcription_updated_ms" => {
                if let Ok(parsed) = value.parse::<i64>() {
                    meta.transcription_updated_ms = Some(parsed);
                } else {
                    meta.passthrough_lines.push(trimmed.to_string());
                }
            }
            "transcription_id" => {
                if !value.is_empty() {
                    meta.transcription_id = Some(value);
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
    if let Some(note_type) = &meta.note_type {
        output.push_str(&format!("type: {}\n", front_matter_safe_value(note_type)));
    }
    if let Some(audio_path) = &meta.recording_audio_path {
        output.push_str(&format!(
            "recording_audio_path: {}\n",
            front_matter_safe_value(audio_path)
        ));
    }
    if let Some(status) = &meta.transcription_status {
        output.push_str(&format!(
            "transcription_status: {}\n",
            front_matter_safe_value(status)
        ));
    }
    if let Some(error) = &meta.transcription_error {
        output.push_str(&format!(
            "transcription_error: {}\n",
            front_matter_safe_value(error)
        ));
    }
    if let Some(updated_ms) = meta.transcription_updated_ms {
        output.push_str(&format!("transcription_updated_ms: {}\n", updated_ms));
    }
    if let Some(transcription_id) = &meta.transcription_id {
        output.push_str(&format!(
            "transcription_id: {}\n",
            front_matter_safe_value(transcription_id)
        ));
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

fn recording_status_label(status: &str) -> &str {
    match status {
        RECORDING_STATUS_QUEUED => "Transcription is queued.",
        RECORDING_STATUS_PROCESSING => "Transcription is processing.",
        RECORDING_STATUS_COMPLETED => "Transcription completed.",
        RECORDING_STATUS_FAILED => "Transcription failed.",
        _ => "Transcription is pending.",
    }
}

fn recording_transcript_section(
    status: &str,
    transcript: Option<&str>,
    error: Option<&str>,
) -> String {
    if status == RECORDING_STATUS_COMPLETED {
        let body = transcript.unwrap_or_default().trim();
        if body.is_empty() {
            return "## Transcript\n\n(AssemblyAI returned an empty transcript.)\n".to_string();
        }
        return format!("## Transcript\n\n{}\n", body);
    }
    if status == RECORDING_STATUS_FAILED {
        let details = error
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or("Unknown transcription error.");
        return format!(
            "## Transcript\n\n(Transcription failed.)\n\nError: {}\n",
            details
        );
    }
    format!("## Transcript\n\n({})\n", recording_status_label(status))
}

fn upsert_recording_transcript_section(body: &str, section: &str) -> String {
    let start_index = body.find(TRANSCRIPT_START_MARKER);
    let end_index = start_index.and_then(|start| {
        body[(start + TRANSCRIPT_START_MARKER.len())..]
            .find(TRANSCRIPT_END_MARKER)
            .map(|relative| start + TRANSCRIPT_START_MARKER.len() + relative)
    });

    if let (Some(start), Some(end)) = (start_index, end_index) {
        let prefix = &body[..start + TRANSCRIPT_START_MARKER.len()];
        let suffix = &body[end..];
        return format!(
            "{}\n\n{}\n\n{}",
            prefix.trim_end(),
            section.trim(),
            suffix.trim_start()
        );
    }

    if body.trim().is_empty() {
        return format!(
            "# Recording\n\n{}\n\n{}\n\n{}\n",
            TRANSCRIPT_START_MARKER,
            section.trim(),
            TRANSCRIPT_END_MARKER
        );
    }

    format!(
        "{}\n\n{}\n\n{}\n\n{}\n",
        body.trim_end(),
        TRANSCRIPT_START_MARKER,
        section.trim(),
        TRANSCRIPT_END_MARKER
    )
}

fn recording_storage_root(root: &Path) -> PathBuf {
    root.join(RECORDINGS_STORAGE_FOLDER)
}

fn is_recording_audio_path_allowed(root: &Path, audio_path: &Path) -> bool {
    audio_path.starts_with(recording_storage_root(root))
        || audio_path.starts_with(root.join(LEGACY_RECORDINGS_FOLDER))
}

fn recording_info_from_note_meta(
    root: &Path,
    note_path: &Path,
    note_rel: &str,
    meta: &NoteFrontMatter,
) -> Option<RecordingNoteInfo> {
    if meta.note_type.as_deref() != Some(RECORDING_FRONTMATTER_TYPE) {
        return None;
    }

    let audio_rel = meta.recording_audio_path.as_ref()?.trim();
    if audio_rel.is_empty() {
        return None;
    }

    let audio_rel_path = sanitize_relative(audio_rel).ok()?;
    let audio_path = root.join(&audio_rel_path);
    if !is_recording_audio_path_allowed(root, &audio_path) {
        return None;
    }

    let status = meta
        .transcription_status
        .as_deref()
        .unwrap_or(RECORDING_STATUS_PENDING)
        .to_string();

    Some(RecordingNoteInfo {
        note_rel: note_rel.to_string(),
        note_path: note_path.to_path_buf(),
        audio_rel: audio_rel_path.to_string_lossy().replace('\\', "/"),
        audio_path,
        status,
        error: meta.transcription_error.clone(),
        updated_ms: meta.transcription_updated_ms.or(meta.updated_ms),
    })
}

fn collect_markdown_note_files(
    root: &Path,
    dir: &Path,
    files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ORDER_FILE {
            continue;
        }
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if metadata.is_dir() {
            if name.starts_with('.') {
                continue;
            }
            if dir == root {
                if HIDDEN_ROOT_FOLDERS.iter().any(|hidden| *hidden == name) {
                    continue;
                }
            }
            collect_markdown_note_files(root, &path, files)?;
            continue;
        }
        if metadata.is_file() && path.extension().and_then(|value| value.to_str()) == Some("md") {
            files.push(path);
        }
    }
    Ok(())
}

fn collect_recording_notes(root: &Path) -> Result<Vec<RecordingNoteInfo>, String> {
    let mut note_files = Vec::new();
    collect_markdown_note_files(root, root, &mut note_files)?;

    let mut recordings = Vec::new();
    for note_path in note_files {
        let raw = match fs::read_to_string(&note_path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let (meta, _) = parse_note_front_matter(&raw);
        let note_rel = strip_root(root, &note_path);
        if let Some(info) = recording_info_from_note_meta(root, &note_path, &note_rel, &meta) {
            recordings.push(info);
        }
    }
    Ok(recordings)
}

fn write_note_with_front_matter(
    path: &Path,
    meta: &NoteFrontMatter,
    body: &str,
) -> Result<(), String> {
    let serialized = render_note_with_front_matter(meta, body);
    fs::write(path, serialized).map_err(|error| error.to_string())
}

fn update_recording_note_status(
    note_path: &Path,
    status: &str,
    error: Option<String>,
    transcript_id: Option<String>,
    transcript_text: Option<&str>,
) -> Result<(), String> {
    let raw = fs::read_to_string(note_path).map_err(|issue| issue.to_string())?;
    let (mut meta, body) = parse_note_front_matter(&raw);
    if meta.id.is_none() {
        meta.id = Some(generate_note_id());
    }
    let now = now_ms();
    if meta.created_ms.is_none() {
        meta.created_ms = now;
    }
    meta.updated_ms = now.or(meta.updated_ms);
    meta.note_type = Some(RECORDING_FRONTMATTER_TYPE.to_string());
    meta.transcription_status = Some(status.to_string());
    meta.transcription_error = error.clone();
    meta.transcription_updated_ms = now.or(meta.transcription_updated_ms);
    meta.transcription_id = transcript_id;

    let section = recording_transcript_section(status, transcript_text, error.as_deref());
    let next_body = upsert_recording_transcript_section(&body, &section);
    write_note_with_front_matter(note_path, &meta, &next_body)
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
        return Err(response_error(
            status,
            body,
            "AssemblyAI transcript request",
        ));
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
                return Err(poll_payload
                    .error
                    .unwrap_or_else(|| "AssemblyAI reported a transcription error.".to_string()));
            }
            _ => {}
        }
    }

    Err("AssemblyAI transcription timed out.".to_string())
}

fn process_transcription_job(job: QueuedTranscriptionJob) {
    if let Err(error) = update_recording_note_status(
        &job.note_path,
        RECORDING_STATUS_PROCESSING,
        None,
        None,
        None,
    ) {
        eprintln!(
            "[recordings] failed to mark processing for {}: {}",
            job.note_rel, error
        );
    }

    let run = || -> Result<(String, String), String> {
        let audio_bytes = fs::read(&job.audio_path).map_err(|error| error.to_string())?;
        transcribe_audio_bytes_with_assembly(audio_bytes, &job.api_key)
    };

    match run() {
        Ok((transcript, transcript_id)) => {
            if let Err(error) = update_recording_note_status(
                &job.note_path,
                RECORDING_STATUS_COMPLETED,
                None,
                Some(transcript_id),
                Some(&transcript),
            ) {
                eprintln!(
                    "[recordings] failed to write transcript for {}: {}",
                    job.note_rel, error
                );
            }
        }
        Err(error) => {
            let _ = update_recording_note_status(
                &job.note_path,
                RECORDING_STATUS_FAILED,
                Some(error.clone()),
                None,
                None,
            );
            eprintln!(
                "[recordings] transcription failed for {}: {}",
                job.note_rel, error
            );
        }
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
                    state.current_recording = Some(job.note_rel.clone());
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
        state.known_recordings.remove(&job.note_rel);
        if state.current_recording.as_deref() == Some(job.note_rel.as_str()) {
            state.current_recording = None;
        }
    });
}

fn recording_initial_body() -> String {
    let section = recording_transcript_section(RECORDING_STATUS_PENDING, None, None);
    format!(
        "# Recording\n\n{}\n\n{}\n\n{}\n",
        TRANSCRIPT_START_MARKER,
        section.trim(),
        TRANSCRIPT_END_MARKER
    )
}

fn recording_note_file_name(folder: &Path) -> Result<String, String> {
    let id = generate_note_id();
    for attempt in 0..=512usize {
        let candidate = if attempt == 0 {
            format!("{}.md", id)
        } else {
            format!("{}-{}.md", id, attempt)
        };
        if !folder.join(&candidate).exists() {
            return Ok(candidate);
        }
    }
    Err("Failed to allocate recording note name.".to_string())
}

fn recording_audio_file_path(root: &Path, extension: &str) -> Result<PathBuf, String> {
    let storage = recording_storage_root(root);
    fs::create_dir_all(&storage).map_err(|error| error.to_string())?;
    for _ in 0..=512usize {
        let candidate = storage.join(format!(
            "{}-{}.{}",
            AUDIO_FILE_NAME_PREFIX,
            Uuid::now_v7(),
            extension
        ));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Failed to allocate recording audio filename.".to_string())
}

fn resolve_recording_target_folder(
    app: &tauri::AppHandle,
    requested: Option<&str>,
) -> Result<(String, PathBuf), String> {
    let root = notes_root(app)?;
    let candidate = requested.unwrap_or("").trim();
    if !candidate.is_empty() {
        let path = resolve_path(app, candidate)?;
        if path.exists()
            && path.is_dir()
            && !path.starts_with(recording_storage_root(&root))
            && !path.starts_with(root.join(LEGACY_RECORDINGS_FOLDER))
        {
            return Ok((strip_root(&root, &path), path));
        }
    }

    let fallback = root.join(FEED_FOLDER);
    Ok((FEED_FOLDER.to_string(), fallback))
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
    if dir
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == FEED_FOLDER)
    {
        return Ok(());
    }
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

fn git_note_timestamps_from_history(
    root: &Path,
    note_rel: &str,
) -> Option<(Option<i64>, Option<i64>)> {
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
    for folder in PROTECTED_SYSTEM_FOLDERS {
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
    repo.graph_ahead_behind(local_oid, upstream_oid)
        .unwrap_or((0, 0))
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

fn git_upstream_oid(repo: &Repository, branch: Option<&str>) -> Option<Oid> {
    let branch_name = branch?;
    repo.find_branch(branch_name, git2::BranchType::Local)
        .ok()
        .and_then(|local| local.upstream().ok())
        .and_then(|upstream| upstream.get().target())
}

fn build_git_history(root: &Path, limit: usize) -> Result<Vec<GitCommitHistoryEntry>, String> {
    if !git_repo_initialized(root) {
        return Ok(Vec::new());
    }
    let repo = open_repo(root)?;
    let head_oid = match repo.head().ok().and_then(|head| head.target()) {
        Some(oid) => oid,
        None => return Ok(Vec::new()),
    };
    let branch = git_current_branch(&repo);
    let upstream_oid = git_upstream_oid(&repo, branch.as_deref());

    let mut revwalk = repo.revwalk().map_err(map_git_error)?;
    revwalk
        .set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
        .map_err(map_git_error)?;
    revwalk.push(head_oid).map_err(map_git_error)?;

    let mut entries = Vec::new();
    let max_items = limit.clamp(1, 200);
    for oid_result in revwalk.take(max_items) {
        let oid = oid_result.map_err(map_git_error)?;
        let commit = repo.find_commit(oid).map_err(map_git_error)?;
        let summary = commit
            .summary()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("No commit message")
            .to_string();
        let author_signature = commit.author();
        let author = author_signature
            .name()
            .or_else(|| author_signature.email())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("Unknown author")
            .to_string();
        let authored_ms = commit.time().seconds().checked_mul(1_000);
        let sync_state = if let Some(upstream) = upstream_oid {
            if oid == upstream
                || repo
                    .graph_descendant_of(upstream, oid)
                    .unwrap_or(false)
            {
                "synced"
            } else {
                "local"
            }
        } else {
            "local"
        };
        let id = oid.to_string();
        let short_id = id.chars().take(8).collect::<String>();
        entries.push(GitCommitHistoryEntry {
            id,
            short_id,
            summary,
            author,
            authored_ms,
            sync_state: sync_state.to_string(),
            is_head: oid == head_oid,
        });
    }
    Ok(entries)
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
        Ok(_) => repo.remote_set_url("origin", url).map_err(map_git_error)?,
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

fn commit_all_changes(
    repo: &Repository,
    message: &str,
    branch: &str,
) -> Result<Option<Oid>, String> {
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

fn merge_fetched_commit(
    repo: &Repository,
    branch: &str,
    fetched_commit: &AnnotatedCommit<'_>,
) -> Result<(), String> {
    let pre_merge_head = repo
        .head()
        .map_err(map_git_error)?
        .peel_to_commit()
        .map_err(map_git_error)?;

    let mut checkout_options = CheckoutBuilder::new();
    checkout_options.safe();
    repo.merge(&[fetched_commit], None, Some(&mut checkout_options))
        .map_err(map_git_error)?;

    let merge_result = (|| -> Result<(), String> {
        let head_commit = repo
            .head()
            .map_err(map_git_error)?
            .peel_to_commit()
            .map_err(map_git_error)?;
        let remote_commit = repo
            .find_commit(fetched_commit.id())
            .map_err(map_git_error)?;
        let mut index = repo.index().map_err(map_git_error)?;
        if index.has_conflicts() {
            let mut paths = Vec::new();
            if let Ok(conflicts) = index.conflicts() {
                for entry in conflicts.flatten() {
                    let path_bytes = entry
                        .our
                        .as_ref()
                        .and_then(|value| std::str::from_utf8(&value.path).ok())
                        .or_else(|| {
                            entry
                                .their
                                .as_ref()
                                .and_then(|value| std::str::from_utf8(&value.path).ok())
                        })
                        .or_else(|| {
                            entry
                                .ancestor
                                .as_ref()
                                .and_then(|value| std::str::from_utf8(&value.path).ok())
                        });
                    if let Some(path) = path_bytes {
                        paths.push(path.to_string());
                    }
                }
            }
            paths.sort();
            paths.dedup();
            let details = if paths.is_empty() {
                String::new()
            } else {
                format!(" ({})", paths.join(", "))
            };
            return Err(
                format!(
                    "Pull produced merge conflicts{}. Resolve conflicts on desktop, then pull again on mobile.",
                    details
                ),
            );
        }
        let tree_id = index.write_tree_to(repo).map_err(map_git_error)?;
        let tree = repo.find_tree(tree_id).map_err(map_git_error)?;
        let signature = default_signature(repo)?;
        let message = format!("Merge origin/{branch} into {branch}");
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &message,
            &tree,
            &[&head_commit, &remote_commit],
        )
        .map_err(map_git_error)?;
        repo.checkout_head(Some(CheckoutBuilder::new().safe()))
            .map_err(map_git_error)?;
        Ok(())
    })();

    match merge_result {
        Ok(()) => {
            repo.cleanup_state().map_err(map_git_error)?;
            Ok(())
        }
        Err(error_message) => {
            let cleanup_error = repo.cleanup_state().map_err(map_git_error).err();
            let reset_error = repo
                .reset(pre_merge_head.as_object(), ResetType::Hard, None)
                .map_err(map_git_error)
                .err();
            if cleanup_error.is_none() && reset_error.is_none() {
                return Err(error_message);
            }
            let mut extras = Vec::new();
            if let Some(value) = cleanup_error {
                extras.push(format!("cleanup_state failed: {value}"));
            }
            if let Some(value) = reset_error {
                extras.push(format!("reset failed: {value}"));
            }
            Err(format!(
                "{error_message} Automatic rollback failed: {}",
                extras.join("; ")
            ))
        }
    }
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
    PROTECTED_SYSTEM_FOLDERS
        .iter()
        .any(|folder| *folder == name)
}

fn is_hidden_root_folder_name(name: &str) -> bool {
    HIDDEN_ROOT_FOLDERS.iter().any(|folder| *folder == name)
}

fn is_feed_folder_path(root: &Path, path: &Path) -> bool {
    path == root.join(FEED_FOLDER)
}

fn migrate_legacy_folder_name(root: &Path, from_name: &str, to_name: &str) -> Result<(), String> {
    let from = root.join(from_name);
    if !from.exists() {
        return Ok(());
    }
    let to = root.join(to_name);
    if !to.exists() {
        fs::rename(&from, &to).map_err(|err| err.to_string())?;
        return Ok(());
    }
    for entry in fs::read_dir(&from).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        if target.exists() {
            continue;
        }
        fs::rename(&source, &target).map_err(|err| err.to_string())?;
    }
    fs::remove_dir_all(&from).map_err(|err| err.to_string())?;
    Ok(())
}

fn migrate_legacy_system_folders(root: &Path) -> Result<(), String> {
    migrate_legacy_folder_name(root, LEGACY_UNSORTED_FOLDER, FEED_FOLDER)?;
    migrate_legacy_folder_name(root, LEGACY_RECORDINGS_FOLDER, RECORDINGS_STORAGE_FOLDER)?;
    let feed_order = root.join(FEED_FOLDER).join(ORDER_FILE);
    if feed_order.exists() {
        let _ = fs::remove_file(feed_order);
    }
    Ok(())
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
    migrate_legacy_system_folders(root)?;

    for folder in REQUIRED_SYSTEM_FOLDERS {
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
    for folder in VISIBLE_SYSTEM_FOLDERS {
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
        if rel_path.is_empty() && is_hidden_root_folder_name(&name) {
            continue;
        }
        let meta = entry.metadata().map_err(|err| err.to_string())?;
        if meta.is_dir() {
            folders.push(name);
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
fn get_profiles(app: tauri::AppHandle) -> Result<NotesProfilesSnapshot, String> {
    let state = ensure_profiles_state(&app).or_else(|_| default_profiles_state(&app))?;
    Ok(profiles_snapshot(&state))
}

#[tauri::command]
fn create_profile(
    app: tauri::AppHandle,
    args: CreateProfileArgs,
) -> Result<NotesProfilesSnapshot, String> {
    let state = create_profile_state(&app, &args.name)?;
    Ok(profiles_snapshot(&state))
}

#[tauri::command]
fn set_active_profile(
    app: tauri::AppHandle,
    args: SetActiveProfileArgs,
) -> Result<NotesProfilesSnapshot, String> {
    let state = set_active_profile_state(&app, &args.profile_id)?;
    Ok(profiles_snapshot(&state))
}

#[tauri::command]
fn set_profile_notes_root(
    app: tauri::AppHandle,
    args: SetProfileNotesRootArgs,
) -> Result<NotesProfilesSnapshot, String> {
    let state = set_profile_notes_root_state(&app, &args.profile_id, &args.notes_root)?;
    Ok(profiles_snapshot(&state))
}

#[tauri::command]
async fn get_git_status(app: tauri::AppHandle) -> Result<GitSyncStatus, String> {
    tauri::async_runtime::spawn_blocking(move || get_git_status_blocking(app))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_git_history(
    app: tauri::AppHandle,
    args: Option<GitHistoryArgs>,
) -> Result<Vec<GitCommitHistoryEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = notes_root(&app)?;
        ensure_system_folders(&root)?;
        let limit = args.and_then(|value| value.limit).unwrap_or(40);
        build_git_history(&root, limit)
    })
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
    let full_path = resolve_path(&app, &path)?;
    if !full_path.exists() || !full_path.is_file() {
        return Err("Note file does not exist.".to_string());
    }
    let raw = fs::read_to_string(full_path).map_err(|err| err.to_string())?;
    let (_, body) = parse_note_front_matter(&raw);
    Ok(body)
}

#[tauri::command]
fn create_note(app: tauri::AppHandle, args: CreateNoteArgs) -> Result<CreateNoteResult, String> {
    let root = notes_root(&app)?;
    ensure_system_folders(&root)?;
    let folder_rel = args
        .folder_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(FEED_FOLDER);
    let folder_full = resolve_path(&app, folder_rel)?;
    if folder_full.starts_with(recording_storage_root(&root))
        || folder_full.starts_with(root.join(LEGACY_RECORDINGS_FOLDER))
    {
        return Err("Notes cannot be created inside recordings storage.".to_string());
    }
    fs::create_dir_all(&folder_full).map_err(|err| err.to_string())?;

    let id = generate_note_id();
    let mut file_name: Option<String> = None;
    for attempt in 0..=512usize {
        let candidate = if attempt == 0 {
            format!("{}.md", id)
        } else {
            format!("{}-{}.md", id, attempt)
        };
        if !folder_full.join(&candidate).exists() {
            file_name = Some(candidate);
            break;
        }
    }
    let file_name = file_name.ok_or_else(|| "Failed to allocate note filename.".to_string())?;
    let path = folder_full.join(&file_name);
    let timestamp = args.timestamp_ms.or_else(now_ms);
    let mut meta = NoteFrontMatter::default();
    meta.id = Some(file_name.trim_end_matches(".md").to_string());
    meta.created_ms = timestamp;
    meta.updated_ms = timestamp;
    let content = args.content.unwrap_or_default();
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
    let full_path = resolve_path(&app, &args.path)?;
    if !full_path.exists() || !full_path.is_file() {
        return Err("Note file does not exist.".to_string());
    }
    let raw = fs::read_to_string(&full_path).map_err(|err| err.to_string())?;
    let (mut meta, body) = parse_note_front_matter(&raw);
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
fn native_audio_recorder_capabilities() -> NativeRecorderCapabilities {
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
        return NativeRecorderCapabilities {
            supported: true,
            recording,
            started_ms,
        };
    }

    #[cfg(not(target_os = "ios"))]
    {
        NativeRecorderCapabilities {
            supported: false,
            recording: false,
            started_ms: None,
        }
    }
}

#[tauri::command]
fn start_native_audio_recording(app: tauri::AppHandle) -> Result<(), String> {
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
fn stop_native_audio_recording() -> Result<RecordingAudioPayload, String> {
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
    let root = notes_root(&app)?;
    ensure_system_folders(&root)?;
    let audio_bytes = decode_audio_base64(&args.audio_base64)?;
    if audio_bytes.is_empty() {
        return Err("Audio payload is empty.".to_string());
    }

    let (target_folder_rel, target_folder_path) =
        resolve_recording_target_folder(&app, args.folder_path.as_deref())?;
    let extension = audio_extension_from_mime(args.mime_type.as_deref());
    let audio_path = recording_audio_file_path(&root, extension)?;
    fs::write(&audio_path, audio_bytes).map_err(|error| error.to_string())?;

    let note_file_name = recording_note_file_name(&target_folder_path)?;
    let note_path = target_folder_path.join(&note_file_name);
    let note_id = note_file_name.trim_end_matches(".md").to_string();
    let now = now_ms();
    let mut meta = NoteFrontMatter::default();
    meta.id = Some(note_id);
    meta.created_ms = now;
    meta.updated_ms = now;
    meta.note_type = Some(RECORDING_FRONTMATTER_TYPE.to_string());
    meta.recording_audio_path = Some(strip_root(&root, &audio_path));
    meta.transcription_status = Some(RECORDING_STATUS_PENDING.to_string());
    meta.transcription_error = None;
    meta.transcription_updated_ms = now;
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
    let recordings = collect_recording_notes(&root)?;
    let active_recordings = {
        let queue = transcription_queue_state();
        let state = queue.lock().expect("transcription queue poisoned");
        let mut active = HashSet::new();
        if let Some(current) = &state.current_recording {
            active.insert(current.clone());
        }
        for job in state.pending.iter() {
            active.insert(job.note_rel.clone());
        }
        active
    };
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

    let (queue_running, current_recording, pending, in_flight) = {
        let queue = transcription_queue_state();
        let state = queue.lock().expect("transcription queue poisoned");
        let pending = state
            .pending
            .iter()
            .map(|job| job.note_rel.clone())
            .collect::<Vec<_>>();
        (
            state.running,
            state.current_recording.clone(),
            pending,
            state.pending.len() + usize::from(state.running),
        )
    };

    let mut recordings = collect_recording_notes(&root)?
        .into_iter()
        .map(|recording| {
            let folder_path = recording
                .note_rel
                .rsplit_once('/')
                .map(|(parent, _)| parent.to_string())
                .unwrap_or_default();
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
                is_queued: pending.iter().any(|value| value == &recording.note_rel),
                is_processing: current_recording.as_deref() == Some(recording.note_rel.as_str()),
            }
        })
        .collect::<Vec<_>>();

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
    let path_rel = sanitize_relative(&args.path)?;
    let audio_path = root.join(path_rel);
    if !is_recording_audio_path_allowed(&root, &audio_path) {
        return Err("Only files inside _Recordings are allowed.".to_string());
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
    let root = notes_root(&app)?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            if let Some(window) = _app.get_webview_window("main") {
                let _ = apply_macos_window_alpha(&window, MACOS_WINDOW_ALPHA);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
            queue_recording_transcriptions,
            list_recordings,
            read_recording_audio,
            move_items,
            delete_items,
            rename_item,
            set_order,
            get_profiles,
            create_profile,
            set_active_profile,
            set_profile_notes_root,
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
