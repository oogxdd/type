use argon2::{
    password_hash::{
        rand_core::{OsRng, RngCore},
        PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
    },
    Argon2,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    Key, XChaCha20Poly1305, XNonce,
};
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
use zeroize::Zeroize;
#[cfg(target_os = "ios")]
use std::{
    ffi::{CStr, CString},
    os::raw::{c_char, c_int},
    ptr,
};
use tauri::Manager;
use time::{macros::format_description, Duration as TimeDuration, OffsetDateTime};
use uuid::Uuid;

mod commands;

const ORDER_FILE: &str = ".notes-order.json";
const PROFILES_FILE: &str = ".notes-profiles.json";
const LEGACY_PROFILES_FILE: &str = ".notes-sessions.json";
const SECURITY_FILE: &str = ".notes-security.json";
const FEED_FOLDER: &str = "Feed";
const LEGACY_UNSORTED_FOLDER: &str = "Unsorted";
const ARCHIEVE_FOLDER: &str = "Archieve";
const RECORDINGS_STORAGE_FOLDER: &str = "Recordings";
const ATTACHMENTS_STORAGE_FOLDER: &str = "Attachments";
const LEGACY_RECORDINGS_FOLDER: &str = "_Recordings";
const AUDIO_FILE_NAME_PREFIX: &str = "audio";
const ATTACHMENT_FILE_NAME_PREFIX: &str = "attachment";
const RECORDING_FRONTMATTER_TYPE: &str = "audio_recording";
const HANDWRITING_FRONTMATTER_TYPE: &str = "handwriting_attachment";
const RECORDING_STATUS_PENDING: &str = "pending";
const RECORDING_STATUS_QUEUED: &str = "queued";
const RECORDING_STATUS_PROCESSING: &str = "processing";
const RECORDING_STATUS_COMPLETED: &str = "completed";
const RECORDING_STATUS_FAILED: &str = "failed";
const HANDWRITING_OCR_PROMPT: &str = "Extract all handwritten text from this image. Return plain text only, preserving line breaks and paragraphs. Do not add commentary.";
const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const HUGGINGFACE_INFERENCE_BASE_URL: &str = "https://api-inference.huggingface.co/models";
const HUGGINGFACE_RETRYABLE_STATUS: reqwest::StatusCode = reqwest::StatusCode::SERVICE_UNAVAILABLE;
const HUGGINGFACE_MAX_RETRIES: usize = 5;
const HUGGINGFACE_RETRY_DELAY: Duration = Duration::from_secs(2);
const ASSEMBLY_UPLOAD_URL: &str = "https://api.assemblyai.com/v2/upload";
const ASSEMBLY_TRANSCRIPT_URL: &str = "https://api.assemblyai.com/v2/transcript";
const ASSEMBLY_SPEECH_MODEL: &str = "universal-2";
const ASSEMBLY_POLL_INTERVAL: Duration = Duration::from_secs(2);
const ASSEMBLY_MAX_POLL_ATTEMPTS: usize = 180;
const SECURITY_NOTE_BODY_PREFIX: &str = "NV_ENC_V1:";
const SECURITY_KEY_SIZE: usize = 32;
const SECURITY_NONCE_SIZE: usize = 24;
const SECURITY_SALT_SIZE: usize = 16;
const SECURITY_LOCKED_ERROR: &str = "Notes are locked. Unlock the app first.";
const VISIBLE_SYSTEM_FOLDERS: [&str; 2] = [FEED_FOLDER, ARCHIEVE_FOLDER];
const REQUIRED_SYSTEM_FOLDERS: [&str; 4] = [
    FEED_FOLDER,
    ARCHIEVE_FOLDER,
    ATTACHMENTS_STORAGE_FOLDER,
    RECORDINGS_STORAGE_FOLDER,
];
const PROTECTED_SYSTEM_FOLDERS: [&str; 6] = [
    FEED_FOLDER,
    ARCHIEVE_FOLDER,
    LEGACY_UNSORTED_FOLDER,
    ATTACHMENTS_STORAGE_FOLDER,
    RECORDINGS_STORAGE_FOLDER,
    LEGACY_RECORDINGS_FOLDER,
];
const HIDDEN_ROOT_FOLDERS: [&str; 3] = [
    ATTACHMENTS_STORAGE_FOLDER,
    RECORDINGS_STORAGE_FOLDER,
    LEGACY_RECORDINGS_FOLDER,
];
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
    note_type: Option<String>,
    recording_audio_path: Option<String>,
    handwriting_attachment_path: Option<String>,
    transcription_status: Option<String>,
    transcription_error: Option<String>,
    transcription_updated_ms: Option<i64>,
    ocr_status: Option<String>,
    ocr_error: Option<String>,
    ocr_updated_ms: Option<i64>,
}

#[derive(Default)]
struct NoteFrontMatter {
    id: Option<String>,
    created_ms: Option<i64>,
    updated_ms: Option<i64>,
    note_type: Option<String>,
    recording_audio_path: Option<String>,
    handwriting_attachment_path: Option<String>,
    transcription_status: Option<String>,
    transcription_error: Option<String>,
    transcription_updated_ms: Option<i64>,
    transcription_id: Option<String>,
    ocr_status: Option<String>,
    ocr_error: Option<String>,
    ocr_updated_ms: Option<i64>,
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
    #[serde(default)]
    description: String,
    notes_root: String,
}

#[derive(Clone, Default, Deserialize, PartialEq, Serialize)]
struct NotesProfilesFile {
    #[serde(default)]
    active_profile_id: String,
    #[serde(default)]
    profiles: Vec<NotesProfileEntry>,
}

#[derive(Clone, Default, Deserialize)]
struct LegacyProfilesMigrationFile {
    #[serde(default, rename = "active_session_id")]
    active_profile_id: String,
    #[serde(default, rename = "sessions")]
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
    description: Option<String>,
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
struct UpdateProfileArgs {
    profile_id: String,
    name: Option<String>,
    description: Option<String>,
}

#[derive(Deserialize)]
struct DeleteProfileArgs {
    profile_id: String,
}

#[derive(Clone, Deserialize, Serialize)]
struct SecurityConfigFile {
    #[serde(default)]
    encryption_enabled: bool,
    #[serde(default)]
    unlock_password_hash: String,
    #[serde(default)]
    panic_password_hash: String,
    #[serde(default)]
    key_salt: String,
    #[serde(default)]
    auto_lock_on_background: bool,
}

impl Default for SecurityConfigFile {
    fn default() -> Self {
        Self {
            encryption_enabled: false,
            unlock_password_hash: String::new(),
            panic_password_hash: String::new(),
            key_salt: String::new(),
            auto_lock_on_background: true,
        }
    }
}

#[derive(Default)]
struct SecurityRuntimeState {
    loaded: bool,
    config: SecurityConfigFile,
    locked: bool,
    key: Option<[u8; SECURITY_KEY_SIZE]>,
}

#[derive(Serialize)]
struct SecurityState {
    encryption_enabled: bool,
    locked: bool,
    auto_lock_on_background: bool,
}

#[derive(Deserialize)]
struct EnableSecurityArgs {
    unlock_password: String,
    panic_password: String,
}

#[derive(Deserialize)]
struct UnlockSecurityArgs {
    password: String,
}

#[derive(Deserialize)]
struct SetSecurityPreferencesArgs {
    auto_lock_on_background: bool,
}

#[derive(Serialize)]
struct SecurityUnlockResult {
    unlocked: bool,
    panic_triggered: bool,
    reset_required: bool,
    message: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
enum NoteFileNameFormat {
    #[default]
    UtcTimestampSlug,
    UuidV7,
    UuidV7PrefixSlug,
}

#[derive(Deserialize)]
struct CreateNoteArgs {
    folder_path: Option<String>,
    content: Option<String>,
    timestamp_ms: Option<i64>,
    #[serde(default)]
    file_name_format: NoteFileNameFormat,
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
    #[serde(default)]
    file_name_format: NoteFileNameFormat,
}

#[derive(Deserialize)]
struct SaveHandwritingAttachmentArgs {
    image_base64: String,
    mime_type: Option<String>,
    file_name: Option<String>,
    folder_path: Option<String>,
    #[serde(default)]
    file_name_format: NoteFileNameFormat,
}

#[derive(Serialize)]
struct RecordingWriteResult {
    folder_path: String,
    note_path: String,
    audio_path: String,
}

#[derive(Serialize)]
struct HandwritingAttachmentWriteResult {
    folder_path: String,
    note_path: String,
    attachment_path: String,
}

#[derive(Deserialize)]
struct QueueRecordingsArgs {
    assembly_api_key: String,
}

#[derive(Deserialize)]
struct QueueHandwritingOcrArgs {
    provider: String,
    api_key: String,
    model: String,
}

#[derive(Serialize)]
struct RecordingTranscriptionQueueResult {
    scanned: usize,
    queued: usize,
    skipped: usize,
    in_flight: usize,
}

#[derive(Serialize)]
struct HandwritingOcrQueueResult {
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
struct HandwritingOcrQueueSnapshot {
    running: bool,
    current_note: Option<String>,
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
struct HandwritingOcrListItem {
    note_path: String,
    folder_path: String,
    attachment_path: Option<String>,
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

#[derive(Serialize)]
struct HandwritingOcrListResult {
    queue: HandwritingOcrQueueSnapshot,
    jobs: Vec<HandwritingOcrListItem>,
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
struct QueuedHandwritingOcrJob {
    note_rel: String,
    note_path: PathBuf,
    attachment_path: PathBuf,
    provider: HandwritingOcrProvider,
    api_key: String,
    model: String,
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

#[derive(Clone)]
struct HandwritingNoteInfo {
    note_rel: String,
    note_path: PathBuf,
    attachment_rel: String,
    attachment_path: PathBuf,
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

#[derive(Copy, Clone)]
enum HandwritingOcrProvider {
    OpenAi,
    HuggingFace,
}

#[derive(Default)]
struct HandwritingOcrQueueState {
    running: bool,
    current_note: Option<String>,
    pending: VecDeque<QueuedHandwritingOcrJob>,
    known_notes: HashSet<String>,
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
static HANDWRITING_OCR_QUEUE: OnceLock<Mutex<HandwritingOcrQueueState>> = OnceLock::new();
static GIT_NOTE_TIMESTAMPS_CACHE: OnceLock<Mutex<HashMap<String, (Option<i64>, Option<i64>)>>> =
    OnceLock::new();
static SECURITY_RUNTIME: OnceLock<Mutex<SecurityRuntimeState>> = OnceLock::new();
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

fn security_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(SECURITY_FILE))
}

fn profile_root_for_id(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("profiles").join(id).join("notes"))
}

fn security_runtime_state() -> &'static Mutex<SecurityRuntimeState> {
    SECURITY_RUNTIME.get_or_init(|| Mutex::new(SecurityRuntimeState::default()))
}

fn reset_runtime_key(state: &mut SecurityRuntimeState, next_key: Option<[u8; SECURITY_KEY_SIZE]>) {
    if let Some(mut existing) = state.key.take() {
        existing.zeroize();
    }
    state.key = next_key;
}

fn read_security_config(app: &tauri::AppHandle) -> Result<SecurityConfigFile, String> {
    let path = security_file_path(app)?;
    if !path.exists() {
        return Ok(SecurityConfigFile::default());
    }
    let raw = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    let parsed =
        serde_json::from_str::<SecurityConfigFile>(&raw).unwrap_or_else(|_| SecurityConfigFile::default());
    Ok(parsed)
}

fn write_security_config(app: &tauri::AppHandle, config: &SecurityConfigFile) -> Result<(), String> {
    let path = security_file_path(app)?;
    let raw = serde_json::to_string_pretty(config).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

fn ensure_security_runtime_loaded(app: &tauri::AppHandle) -> Result<(), String> {
    let runtime = security_runtime_state();
    let mut state = runtime
        .lock()
        .map_err(|_| "Security runtime lock poisoned.".to_string())?;
    if state.loaded {
        return Ok(());
    }
    let config = read_security_config(app)?;
    state.config = config.clone();
    state.loaded = true;
    state.locked = config.encryption_enabled;
    reset_runtime_key(&mut state, None);
    Ok(())
}

fn ensure_security_runtime_initialized_for_setup(app: &tauri::AppHandle) -> Result<(), String> {
    ensure_security_runtime_loaded(app)
}

fn security_state_snapshot(app: &tauri::AppHandle) -> Result<SecurityState, String> {
    ensure_security_runtime_loaded(app)?;
    let runtime = security_runtime_state();
    let state = runtime
        .lock()
        .map_err(|_| "Security runtime lock poisoned.".to_string())?;
    Ok(SecurityState {
        encryption_enabled: state.config.encryption_enabled,
        locked: state.config.encryption_enabled && state.locked,
        auto_lock_on_background: state.config.auto_lock_on_background,
    })
}

fn security_password_hash(value: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(value.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| error.to_string())
}

fn security_password_matches(value: &str, hash: &str) -> Result<bool, String> {
    if hash.trim().is_empty() {
        return Ok(false);
    }
    let parsed = PasswordHash::new(hash).map_err(|error| error.to_string())?;
    Ok(Argon2::default()
        .verify_password(value.as_bytes(), &parsed)
        .is_ok())
}

fn decode_security_key_salt(config: &SecurityConfigFile) -> Result<Vec<u8>, String> {
    let trimmed = config.key_salt.trim();
    if trimmed.is_empty() {
        return Err("Security key salt is not configured.".to_string());
    }
    BASE64.decode(trimmed).map_err(|error| error.to_string())
}

fn derive_security_key(password: &str, salt: &[u8]) -> Result<[u8; SECURITY_KEY_SIZE], String> {
    let mut key = [0u8; SECURITY_KEY_SIZE];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|error| error.to_string())?;
    Ok(key)
}

fn is_encrypted_note_body(body: &str) -> bool {
    body.trim_start().starts_with(SECURITY_NOTE_BODY_PREFIX)
}

fn encrypt_note_body_with_key(body: &str, key: &[u8; SECURITY_KEY_SIZE]) -> Result<String, String> {
    if is_encrypted_note_body(body) {
        return Ok(body.to_string());
    }
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let mut nonce_bytes = [0u8; SECURITY_NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce_bytes);
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce_bytes), body.as_bytes())
        .map_err(|error| error.to_string())?;
    let mut payload = Vec::with_capacity(SECURITY_NONCE_SIZE + ciphertext.len());
    payload.extend_from_slice(&nonce_bytes);
    payload.extend_from_slice(&ciphertext);
    Ok(format!("{}{}", SECURITY_NOTE_BODY_PREFIX, BASE64.encode(payload)))
}

fn decrypt_note_body_with_key(body: &str, key: &[u8; SECURITY_KEY_SIZE]) -> Result<String, String> {
    if !is_encrypted_note_body(body) {
        return Ok(body.to_string());
    }
    let encoded = body
        .trim_start()
        .trim()
        .strip_prefix(SECURITY_NOTE_BODY_PREFIX)
        .ok_or_else(|| "Invalid encrypted note marker.".to_string())?;
    let payload = BASE64.decode(encoded).map_err(|error| error.to_string())?;
    if payload.len() <= SECURITY_NONCE_SIZE {
        return Err("Encrypted note payload is invalid.".to_string());
    }
    let (nonce_bytes, ciphertext) = payload.split_at(SECURITY_NONCE_SIZE);
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let decrypted = cipher
        .decrypt(XNonce::from_slice(nonce_bytes), ciphertext)
        .map_err(|_| "Failed to decrypt note. Wrong password or corrupted content.".to_string())?;
    String::from_utf8(decrypted).map_err(|error| error.to_string())
}

fn decrypt_note_body_for_read(body: &str) -> Result<String, String> {
    if !is_encrypted_note_body(body) {
        return Ok(body.to_string());
    }
    let runtime = security_runtime_state();
    let state = runtime
        .lock()
        .map_err(|_| "Security runtime lock poisoned.".to_string())?;
    let key = state
        .key
        .as_ref()
        .ok_or_else(|| SECURITY_LOCKED_ERROR.to_string())?;
    decrypt_note_body_with_key(body, key)
}

fn encrypt_note_body_for_write(body: &str) -> Result<String, String> {
    let runtime = security_runtime_state();
    let state = runtime
        .lock()
        .map_err(|_| "Security runtime lock poisoned.".to_string())?;
    if !state.config.encryption_enabled {
        return Ok(body.to_string());
    }
    let key = state
        .key
        .as_ref()
        .ok_or_else(|| SECURITY_LOCKED_ERROR.to_string())?;
    encrypt_note_body_with_key(body, key)
}

fn ensure_security_unlocked_for_app(app: &tauri::AppHandle) -> Result<(), String> {
    ensure_security_runtime_loaded(app)?;
    let runtime = security_runtime_state();
    let state = runtime
        .lock()
        .map_err(|_| "Security runtime lock poisoned.".to_string())?;
    if state.config.encryption_enabled && state.locked {
        return Err(SECURITY_LOCKED_ERROR.to_string());
    }
    Ok(())
}

fn collect_profile_roots(state: &NotesProfilesFile) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut roots = Vec::new();
    for profile in &state.profiles {
        let path = PathBuf::from(profile.notes_root.trim());
        let key = path.to_string_lossy().to_string();
        if seen.insert(key) {
            roots.push(path);
        }
    }
    roots
}

fn migrate_root_note_bodies_to_encrypted(
    root: &Path,
    key: &[u8; SECURITY_KEY_SIZE],
) -> Result<(), String> {
    let mut note_files = Vec::new();
    collect_markdown_note_files(root, root, &mut note_files)?;
    for note_path in note_files {
        let raw = fs::read_to_string(&note_path).map_err(|error| error.to_string())?;
        let (meta, body) = parse_note_front_matter(&raw);
        let encrypted_body = encrypt_note_body_with_key(&body, key)?;
        let rendered = render_note_with_front_matter(&meta, &encrypted_body);
        fs::write(&note_path, rendered).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn seed_dummy_notes(root: &Path) -> Result<(), String> {
    let feed = root.join(FEED_FOLDER);
    fs::create_dir_all(&feed).map_err(|error| error.to_string())?;
    let now = now_ms().unwrap_or(0);
    let templates = [
        (
            "dummy-1-welcome.md",
            "Welcome back\n\nThis is a reset sample note.",
        ),
        (
            "dummy-2-local-sync.md",
            "Local sync\n\nUse a LAN/hotspot Git remote from Settings > Profile.",
        ),
        (
            "dummy-3-security.md",
            "Security reset\n\nYour app data was reset and this is a sample note.",
        ),
    ];
    for (index, (name, body)) in templates.iter().enumerate() {
        let path = feed.join(name);
        let mut meta = NoteFrontMatter::default();
        meta.id = Some(generate_note_id());
        meta.created_ms = Some(now + index as i64);
        meta.updated_ms = Some(now + index as i64);
        let rendered = render_note_with_front_matter(&meta, body);
        fs::write(path, rendered).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn panic_reset_local_data(app: &tauri::AppHandle) -> Result<(), String> {
    let state = ensure_profiles_state(app).or_else(|_| default_profiles_state(app))?;
    for root in collect_profile_roots(&state) {
        if root.exists() {
            fs::remove_dir_all(&root).map_err(|error| error.to_string())?;
        }
    }

    if let Ok(path) = profiles_file_path(app) {
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }
    if let Ok(path) = legacy_profiles_file_path(app) {
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }
    if let Ok(path) = security_file_path(app) {
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }
    if let Ok(path) = app_data_dir(app).map(|dir| dir.join("native-recordings")) {
        if path.exists() {
            let _ = fs::remove_dir_all(path);
        }
    }

    let next_state = default_profiles_state(app)?;
    write_profiles_state(app, &next_state)?;
    let active = find_profile(&next_state, &next_state.active_profile_id)
        .or_else(|| next_state.profiles.first())
        .ok_or_else(|| "No profiles configured.".to_string())?;
    let root = PathBuf::from(&active.notes_root);
    ensure_system_folders(&root)?;
    seed_dummy_notes(&root)?;

    let runtime = security_runtime_state();
    let mut runtime_state = runtime
        .lock()
        .map_err(|_| "Security runtime lock poisoned.".to_string())?;
    runtime_state.loaded = true;
    runtime_state.config = SecurityConfigFile::default();
    runtime_state.locked = false;
    reset_runtime_key(&mut runtime_state, None);
    Ok(())
}

fn get_security_state_impl(app: &tauri::AppHandle) -> Result<SecurityState, String> {
    security_state_snapshot(app)
}

fn enable_security_impl(app: &tauri::AppHandle, args: EnableSecurityArgs) -> Result<SecurityState, String> {
    ensure_security_runtime_loaded(app)?;
    let unlock_password = args.unlock_password.trim();
    let panic_password = args.panic_password.trim();
    if unlock_password.is_empty() || panic_password.is_empty() {
        return Err("Unlock and panic passwords are required.".to_string());
    }
    if unlock_password == panic_password {
        return Err("Unlock and panic passwords must be different.".to_string());
    }

    let mut salt_bytes = vec![0u8; SECURITY_SALT_SIZE];
    OsRng.fill_bytes(&mut salt_bytes);
    let key = derive_security_key(unlock_password, &salt_bytes)?;
    let unlock_hash = security_password_hash(unlock_password)?;
    let panic_hash = security_password_hash(panic_password)?;

    let profiles_state = ensure_profiles_state(app).or_else(|_| default_profiles_state(app))?;
    for root in collect_profile_roots(&profiles_state) {
        if !root.exists() {
            continue;
        }
        migrate_root_note_bodies_to_encrypted(&root, &key)?;
    }

    let config = SecurityConfigFile {
        encryption_enabled: true,
        unlock_password_hash: unlock_hash,
        panic_password_hash: panic_hash,
        key_salt: BASE64.encode(salt_bytes),
        auto_lock_on_background: true,
    };
    write_security_config(app, &config)?;

    let runtime = security_runtime_state();
    let mut runtime_state = runtime
        .lock()
        .map_err(|_| "Security runtime lock poisoned.".to_string())?;
    runtime_state.loaded = true;
    runtime_state.config = config.clone();
    runtime_state.locked = false;
    reset_runtime_key(&mut runtime_state, Some(key));

    Ok(SecurityState {
        encryption_enabled: true,
        locked: false,
        auto_lock_on_background: config.auto_lock_on_background,
    })
}

fn lock_security_impl(app: &tauri::AppHandle) -> Result<SecurityState, String> {
    ensure_security_runtime_loaded(app)?;
    let runtime = security_runtime_state();
    let mut state = runtime
        .lock()
        .map_err(|_| "Security runtime lock poisoned.".to_string())?;
    if !state.config.encryption_enabled {
        return Ok(SecurityState {
            encryption_enabled: false,
            locked: false,
            auto_lock_on_background: state.config.auto_lock_on_background,
        });
    }
    state.locked = true;
    reset_runtime_key(&mut state, None);
    Ok(SecurityState {
        encryption_enabled: true,
        locked: true,
        auto_lock_on_background: state.config.auto_lock_on_background,
    })
}

fn unlock_security_impl(
    app: &tauri::AppHandle,
    args: UnlockSecurityArgs,
) -> Result<SecurityUnlockResult, String> {
    ensure_security_runtime_loaded(app)?;
    let password = args.password.trim();
    if password.is_empty() {
        return Ok(SecurityUnlockResult {
            unlocked: false,
            panic_triggered: false,
            reset_required: false,
            message: Some("Password is required.".to_string()),
        });
    }

    let runtime = security_runtime_state();
    let mut state = runtime
        .lock()
        .map_err(|_| "Security runtime lock poisoned.".to_string())?;
    if !state.config.encryption_enabled {
        state.locked = false;
        reset_runtime_key(&mut state, None);
        return Ok(SecurityUnlockResult {
            unlocked: true,
            panic_triggered: false,
            reset_required: false,
            message: None,
        });
    }

    if security_password_matches(password, &state.config.panic_password_hash)? {
        drop(state);
        panic_reset_local_data(app)?;
        return Ok(SecurityUnlockResult {
            unlocked: true,
            panic_triggered: true,
            reset_required: true,
            message: None,
        });
    }

    if !security_password_matches(password, &state.config.unlock_password_hash)? {
        return Ok(SecurityUnlockResult {
            unlocked: false,
            panic_triggered: false,
            reset_required: false,
            message: Some("Invalid password.".to_string()),
        });
    }

    let salt = decode_security_key_salt(&state.config)?;
    let key = derive_security_key(password, &salt)?;
    state.locked = false;
    reset_runtime_key(&mut state, Some(key));
    Ok(SecurityUnlockResult {
        unlocked: true,
        panic_triggered: false,
        reset_required: false,
        message: None,
    })
}

fn set_security_preferences_impl(
    app: &tauri::AppHandle,
    args: SetSecurityPreferencesArgs,
) -> Result<SecurityState, String> {
    ensure_security_runtime_loaded(app)?;
    let runtime = security_runtime_state();
    let mut state = runtime
        .lock()
        .map_err(|_| "Security runtime lock poisoned.".to_string())?;
    state.config.auto_lock_on_background = args.auto_lock_on_background;
    write_security_config(app, &state.config)?;
    Ok(SecurityState {
        encryption_enabled: state.config.encryption_enabled,
        locked: state.config.encryption_enabled && state.locked,
        auto_lock_on_background: state.config.auto_lock_on_background,
    })
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

fn normalize_profile_description(description: &str) -> String {
    description.trim().to_string()
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
            description: String::new(),
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
        profile.description = normalize_profile_description(&profile.description);
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

fn migrate_legacy_profiles_state(state: LegacyProfilesMigrationFile) -> NotesProfilesFile {
    NotesProfilesFile {
        active_profile_id: state.active_profile_id,
        profiles: state.profiles,
    }
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
        let migrated =
            if let Ok(parsed_profiles) = serde_json::from_str::<NotesProfilesFile>(&content) {
                parsed_profiles
            } else if let Ok(parsed_legacy) =
                serde_json::from_str::<LegacyProfilesMigrationFile>(&content)
            {
                migrate_legacy_profiles_state(parsed_legacy)
            } else {
                NotesProfilesFile::default()
            };
        if !migrated.profiles.is_empty() {
            let normalized = normalize_profiles_state(app, migrated)?;
            write_profiles_state(app, &normalized)?;
            let _ = fs::remove_file(&legacy_path);
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

fn create_profile_state(
    app: &tauri::AppHandle,
    name: &str,
    description: Option<&str>,
) -> Result<NotesProfilesFile, String> {
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
        description: normalize_profile_description(description.unwrap_or("")),
        notes_root: profile_root.to_string_lossy().to_string(),
    });
    state.active_profile_id = profile_id;
    write_profiles_state(app, &state)?;
    Ok(state)
}

fn update_profile_state(
    app: &tauri::AppHandle,
    profile_id: &str,
    name: Option<&str>,
    description: Option<&str>,
) -> Result<NotesProfilesFile, String> {
    let mut state = ensure_profiles_state(app)?;
    let id = profile_id.trim();
    if id.is_empty() {
        return Err("Profile id is required.".to_string());
    }
    let Some(index) = state.profiles.iter().position(|profile| profile.id == id) else {
        return Err(format!("Profile not found: {}", id));
    };
    if let Some(next_name) = name {
        state.profiles[index].name = normalize_profile_name(next_name);
    }
    if let Some(next_description) = description {
        state.profiles[index].description = normalize_profile_description(next_description);
    }
    write_profiles_state(app, &state)?;
    Ok(state)
}

fn delete_profile_state(
    app: &tauri::AppHandle,
    profile_id: &str,
) -> Result<NotesProfilesFile, String> {
    let mut state = ensure_profiles_state(app)?;
    let id = profile_id.trim();
    if id.is_empty() {
        return Err("Profile id is required.".to_string());
    }
    if state.profiles.len() <= 1 {
        return Err("At least one profile must remain.".to_string());
    }
    let Some(index) = state.profiles.iter().position(|profile| profile.id == id) else {
        return Err(format!("Profile not found: {}", id));
    };
    state.profiles.remove(index);
    if state.active_profile_id == id {
        let next_active = state
            .profiles
            .first()
            .ok_or_else(|| "At least one profile must remain.".to_string())?;
        state.active_profile_id = next_active.id.clone();
    }
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

fn ensured_notes_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = notes_root(app)?;
    ensure_system_folders(&root)?;
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

fn handwriting_ocr_queue_state() -> &'static Mutex<HandwritingOcrQueueState> {
    HANDWRITING_OCR_QUEUE.get_or_init(|| Mutex::new(HandwritingOcrQueueState::default()))
}

fn active_transcription_note_paths() -> HashSet<String> {
    let queue = transcription_queue_state();
    let state = queue.lock().expect("transcription queue poisoned");
    let mut active = HashSet::with_capacity(state.pending.len() + 1);
    if let Some(current) = &state.current_recording {
        active.insert(current.clone());
    }
    active.extend(state.pending.iter().map(|job| job.note_rel.clone()));
    active
}

fn active_handwriting_note_paths() -> HashSet<String> {
    let queue = handwriting_ocr_queue_state();
    let state = queue.lock().expect("handwriting ocr queue poisoned");
    let mut active = HashSet::with_capacity(state.pending.len() + 1);
    if let Some(current) = &state.current_note {
        active.insert(current.clone());
    }
    active.extend(state.pending.iter().map(|job| job.note_rel.clone()));
    active
}

fn recording_queue_snapshot() -> RecordingQueueSnapshot {
    let queue = transcription_queue_state();
    let state = queue.lock().expect("transcription queue poisoned");
    let pending = state
        .pending
        .iter()
        .map(|job| job.note_rel.clone())
        .collect::<Vec<_>>();
    RecordingQueueSnapshot {
        running: state.running,
        current_recording: state.current_recording.clone(),
        in_flight: pending.len() + usize::from(state.running),
        pending,
    }
}

fn handwriting_queue_snapshot() -> HandwritingOcrQueueSnapshot {
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

fn note_parent_folder_path(note_rel: &str) -> String {
    note_rel
        .rsplit_once('/')
        .map(|(parent, _)| parent.to_string())
        .unwrap_or_default()
}

fn parse_handwriting_ocr_provider(value: &str) -> Result<HandwritingOcrProvider, String> {
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

fn now_ms() -> Option<i64> {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?;
    i64::try_from(duration.as_millis()).ok()
}

fn time_to_ms(time: std::time::SystemTime) -> Option<i64> {
    let duration = time.duration_since(std::time::UNIX_EPOCH).ok()?;
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
            "handwriting_attachment_path" => {
                if !value.is_empty() {
                    meta.handwriting_attachment_path = Some(value);
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
            "ocr_status" => {
                if !value.is_empty() {
                    meta.ocr_status = Some(value);
                }
            }
            "ocr_error" => {
                if !value.is_empty() {
                    meta.ocr_error = Some(value);
                }
            }
            "ocr_updated_ms" => {
                if let Ok(parsed) = value.parse::<i64>() {
                    meta.ocr_updated_ms = Some(parsed);
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
    if let Some(note_type) = &meta.note_type {
        output.push_str(&format!("type: {}\n", front_matter_safe_value(note_type)));
    }
    if let Some(audio_path) = &meta.recording_audio_path {
        output.push_str(&format!(
            "recording_audio_path: {}\n",
            front_matter_safe_value(audio_path)
        ));
    }
    if let Some(attachment_path) = &meta.handwriting_attachment_path {
        output.push_str(&format!(
            "handwriting_attachment_path: {}\n",
            front_matter_safe_value(attachment_path)
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
    if let Some(status) = &meta.ocr_status {
        output.push_str(&format!(
            "ocr_status: {}\n",
            front_matter_safe_value(status)
        ));
    }
    if let Some(error) = &meta.ocr_error {
        output.push_str(&format!("ocr_error: {}\n", front_matter_safe_value(error)));
    }
    if let Some(updated_ms) = meta.ocr_updated_ms {
        output.push_str(&format!("ocr_updated_ms: {}\n", updated_ms));
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

fn uuid_tail_without_timestamp_prefix(note_id: &str) -> String {
    let parts = note_id.split('-').collect::<Vec<_>>();
    if parts.len() >= 5 {
        return parts[2..].join("-").to_lowercase();
    }
    note_id.to_lowercase()
}

fn uuid_prefix_with_timestamp(note_id: &str) -> String {
    let lower = note_id.to_lowercase();
    lower.chars().take(13).collect()
}

fn utc_note_filename_timestamp(timestamp_ms: i64) -> String {
    let seconds = timestamp_ms.div_euclid(1_000);
    let millis = timestamp_ms.rem_euclid(1_000);
    let nanos = millis.saturating_mul(1_000_000);
    let base = OffsetDateTime::from_unix_timestamp(seconds).unwrap_or(OffsetDateTime::UNIX_EPOCH);
    let value = base + TimeDuration::nanoseconds(nanos);
    value
        .format(&format_description!(
            "[year]-[month]-[day]T[hour]-[minute]-[second]Z"
        ))
        .unwrap_or_else(|_| "1970-01-01T00-00-00Z".to_string())
}

fn is_noise_hash_token(value: &str) -> bool {
    !value.is_empty() && value.len() <= 32 && value.chars().all(|ch| ch.is_ascii_alphanumeric())
}

fn slug_from_content(content: &str, fallback: &str) -> String {
    const MAX_SLUG_WORDS: usize = 8;
    const MAX_SLUG_CHARS: usize = 56;

    let mut normalized = String::with_capacity(content.len().saturating_mul(2));
    for ch in content.chars() {
        if ch.is_alphanumeric() || ch == '-' || ch == '_' || ch.is_whitespace() {
            for lower in ch.to_lowercase() {
                normalized.push(lower);
            }
        } else {
            normalized.push(' ');
        }
    }

    let tokens: Vec<&str> = normalized
        .split(|ch: char| ch.is_whitespace() || ch == '-' || ch == '_')
        .filter(|token| !token.is_empty())
        .collect();

    let mut words = Vec::new();
    let mut index = 0usize;
    while index < tokens.len() && words.len() < MAX_SLUG_WORDS {
        if index + 3 < tokens.len()
            && tokens[index] == "nv"
            && tokens[index + 1] == "empty"
            && tokens[index + 2] == "line"
            && tokens[index + 3] == "token"
        {
            index += 4;
            if index < tokens.len() && is_noise_hash_token(tokens[index]) {
                index += 1;
            }
            continue;
        }

        let token = tokens[index];
        index += 1;
        if token.starts_with("http") || token.starts_with("www") {
            continue;
        }
        words.push(token.to_string());
    }

    let mut slug = if words.is_empty() {
        fallback.to_string()
    } else {
        words.join("-")
    };

    if slug.chars().count() > MAX_SLUG_CHARS {
        slug = slug.chars().take(MAX_SLUG_CHARS).collect();
    }

    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        fallback.to_string()
    } else {
        slug
    }
}

fn allocate_prefixed_note_file_name(
    folder: &Path,
    prefix: &str,
    slug: &str,
) -> Result<String, String> {
    for attempt in 0..=512usize {
        let candidate = if attempt == 0 {
            format!("{}-{}.md", prefix, slug)
        } else {
            format!("{}-{}-{}.md", prefix, slug, attempt)
        };
        if !folder.join(&candidate).exists() {
            return Ok(candidate);
        }
    }
    Err("Failed to allocate note filename.".to_string())
}

fn allocate_uuid_v7_note_file_name(folder: &Path, note_id: &str) -> Result<String, String> {
    let base = note_id.to_lowercase();
    for attempt in 0..=512usize {
        let candidate = if attempt == 0 {
            format!("{}.md", base)
        } else {
            format!("{}-{}.md", base, attempt)
        };
        if !folder.join(&candidate).exists() {
            return Ok(candidate);
        }
    }
    Err("Failed to allocate note filename.".to_string())
}

fn allocate_note_file_name(
    folder: &Path,
    timestamp_ms: i64,
    note_id: &str,
    content: &str,
    fallback_slug: &str,
    file_name_format: NoteFileNameFormat,
) -> Result<String, String> {
    match file_name_format {
        NoteFileNameFormat::UtcTimestampSlug => {
            let prefix = utc_note_filename_timestamp(timestamp_ms);
            let slug = slug_from_content(content, fallback_slug);
            allocate_prefixed_note_file_name(folder, &prefix, &slug)
        }
        NoteFileNameFormat::UuidV7 => allocate_uuid_v7_note_file_name(folder, note_id),
        NoteFileNameFormat::UuidV7PrefixSlug => {
            let prefix = uuid_prefix_with_timestamp(note_id);
            let slug = slug_from_content(content, fallback_slug);
            allocate_prefixed_note_file_name(folder, &prefix, &slug)
        }
    }
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

fn normalize_image_extension(value: &str) -> Option<&'static str> {
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

fn supported_image_extension(
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

fn decode_base64_payload(payload: &str, kind: &str) -> Result<Vec<u8>, String> {
    let trimmed = payload.trim();
    if trimmed.is_empty() {
        return Err(format!("{} payload is empty.", kind));
    }
    let body = trimmed
        .split_once(',')
        .map(|(_, value)| value)
        .unwrap_or(trimmed);
    BASE64
        .decode(body)
        .map_err(|error| format!("Invalid base64 {} payload: {}", kind.to_lowercase(), error))
}

fn decode_audio_base64(payload: &str) -> Result<Vec<u8>, String> {
    decode_base64_payload(payload, "Audio")
}

fn decode_image_base64(payload: &str) -> Result<Vec<u8>, String> {
    decode_base64_payload(payload, "Image")
}

fn response_error(status: reqwest::StatusCode, body: String, context: &str) -> String {
    let compact = body.replace('\n', " ");
    if compact.trim().is_empty() {
        format!("{} failed (HTTP {}).", context, status)
    } else {
        format!("{} failed (HTTP {}): {}", context, status, compact)
    }
}

fn recording_note_body(status: &str, transcript: Option<&str>) -> String {
    if status != RECORDING_STATUS_COMPLETED {
        return String::new();
    }
    let value = transcript.unwrap_or_default().trim();
    if value.is_empty() {
        String::new()
    } else {
        format!("{}\n", value)
    }
}

fn recording_storage_root(root: &Path) -> PathBuf {
    root.join(RECORDINGS_STORAGE_FOLDER)
}

fn handwriting_storage_root(root: &Path) -> PathBuf {
    root.join(ATTACHMENTS_STORAGE_FOLDER)
}

fn is_storage_folder_path(root: &Path, path: &Path) -> bool {
    path.starts_with(recording_storage_root(root))
        || path.starts_with(root.join(LEGACY_RECORDINGS_FOLDER))
        || path.starts_with(handwriting_storage_root(root))
}

fn is_recording_audio_path_allowed(root: &Path, audio_path: &Path) -> bool {
    audio_path.starts_with(recording_storage_root(root))
        || audio_path.starts_with(root.join(LEGACY_RECORDINGS_FOLDER))
}

fn is_handwriting_attachment_path_allowed(root: &Path, attachment_path: &Path) -> bool {
    attachment_path.starts_with(handwriting_storage_root(root))
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

fn collect_handwriting_notes(root: &Path) -> Result<Vec<HandwritingNoteInfo>, String> {
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

fn write_note_with_front_matter(
    path: &Path,
    meta: &NoteFrontMatter,
    body: &str,
) -> Result<(), String> {
    let body_to_write = encrypt_note_body_for_write(body)?;
    let serialized = render_note_with_front_matter(meta, &body_to_write);
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
    let (mut meta, _) = parse_note_front_matter(&raw);
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

    let next_body = recording_note_body(status, transcript_text);
    write_note_with_front_matter(note_path, &meta, &next_body)
}

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

fn update_handwriting_note_status(
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

fn extract_openai_output_text(payload: &serde_json::Value) -> Option<String> {
    if let Some(value) = payload.get("output_text") {
        if let Some(text) = value.as_str() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        if let Some(items) = value.as_array() {
            let joined = items
                .iter()
                .filter_map(|item| item.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            if !joined.trim().is_empty() {
                return Some(joined);
            }
        }
    }

    let mut chunks = Vec::new();
    if let Some(output) = payload.get("output").and_then(|value| value.as_array()) {
        for block in output {
            if let Some(contents) = block.get("content").and_then(|value| value.as_array()) {
                for item in contents {
                    if let Some(text) = item.get("text").and_then(|value| value.as_str()) {
                        let trimmed = text.trim();
                        if !trimmed.is_empty() {
                            chunks.push(trimmed.to_string());
                        }
                    }
                }
            }
        }
    }
    if chunks.is_empty() {
        None
    } else {
        Some(chunks.join("\n"))
    }
}

fn transcribe_handwriting_with_openai(
    image_bytes: &[u8],
    mime_type: &str,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())?;

    let image_data_url = format!("data:{};base64,{}", mime_type, BASE64.encode(image_bytes));
    let response = client
        .post(OPENAI_RESPONSES_URL)
        .header("authorization", format!("Bearer {}", api_key))
        .json(&serde_json::json!({
            "model": model,
            "input": [{
                "role": "user",
                "content": [
                    { "type": "input_text", "text": HANDWRITING_OCR_PROMPT },
                    { "type": "input_image", "image_url": image_data_url }
                ]
            }]
        }))
        .send()
        .map_err(|error| format!("OpenAI OCR request failed: {}", error))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(response_error(status, body, "OpenAI OCR request"));
    }

    let payload = response
        .json::<serde_json::Value>()
        .map_err(|error| format!("OpenAI OCR response parse failed: {}", error))?;
    extract_openai_output_text(&payload)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| "OpenAI OCR did not return text.".to_string())
}

fn parse_huggingface_text(payload: &serde_json::Value) -> Option<String> {
    if let Some(text) = payload
        .get("generated_text")
        .and_then(|value| value.as_str())
    {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    if let Some(text) = payload.get("text").and_then(|value| value.as_str()) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    if let Some(items) = payload.as_array() {
        for item in items {
            if let Some(found) = parse_huggingface_text(item) {
                return Some(found);
            }
        }
    }
    None
}

fn transcribe_handwriting_with_huggingface(
    image_bytes: &[u8],
    mime_type: &str,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())?;

    let endpoint = format!("{}/{}", HUGGINGFACE_INFERENCE_BASE_URL, model);
    for attempt in 0..HUGGINGFACE_MAX_RETRIES {
        let response = client
            .post(&endpoint)
            .header("authorization", format!("Bearer {}", api_key))
            .header("content-type", mime_type)
            .body(image_bytes.to_vec())
            .send()
            .map_err(|error| format!("Hugging Face OCR request failed: {}", error))?;

        if response.status().is_success() {
            let payload = response
                .json::<serde_json::Value>()
                .map_err(|error| format!("Hugging Face OCR response parse failed: {}", error))?;
            if let Some(message) = payload.get("error").and_then(|value| value.as_str()) {
                let retryable = message.to_lowercase().contains("loading");
                if retryable && attempt + 1 < HUGGINGFACE_MAX_RETRIES {
                    thread::sleep(HUGGINGFACE_RETRY_DELAY);
                    continue;
                }
                return Err(format!("Hugging Face OCR failed: {}", message));
            }
            return parse_huggingface_text(&payload)
                .filter(|text| !text.trim().is_empty())
                .ok_or_else(|| "Hugging Face OCR did not return text.".to_string());
        }

        if response.status() == HUGGINGFACE_RETRYABLE_STATUS
            && attempt + 1 < HUGGINGFACE_MAX_RETRIES
        {
            thread::sleep(HUGGINGFACE_RETRY_DELAY);
            continue;
        }

        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(response_error(status, body, "Hugging Face OCR request"));
    }

    Err("Hugging Face OCR timed out while waiting for the model to load.".to_string())
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

fn spawn_handwriting_ocr_worker_if_needed() {
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

fn recording_initial_body() -> String {
    String::new()
}

fn handwriting_initial_body() -> String {
    String::new()
}

fn recording_note_file_name(
    folder: &Path,
    timestamp_ms: i64,
    note_id: &str,
    file_name_format: NoteFileNameFormat,
) -> Result<String, String> {
    let fallback = format!("recording-{}", uuid_tail_without_timestamp_prefix(note_id));
    allocate_note_file_name(
        folder,
        timestamp_ms,
        note_id,
        "",
        &fallback,
        file_name_format,
    )
}

fn handwriting_note_file_name(
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

fn handwriting_attachment_file_path(root: &Path, extension: &str) -> Result<PathBuf, String> {
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

fn resolve_recording_target_folder(
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

fn resolve_handwriting_target_folder(
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
            if oid == upstream || repo.graph_descendant_of(upstream, oid).unwrap_or(false) {
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

fn note_created_ms_for_sort(path: &Path) -> i64 {
    if let Ok(raw) = fs::read_to_string(path) {
        let (meta, _) = parse_note_front_matter(&raw);
        if let Some(created_ms) = meta.created_ms {
            return created_ms;
        }
    }
    if let Ok(metadata) = fs::metadata(path) {
        if let Ok(created) = metadata.created() {
            if let Some(created_ms) = time_to_ms(created) {
                return created_ms;
            }
        }
        if let Ok(modified) = metadata.modified() {
            if let Some(modified_ms) = time_to_ms(modified) {
                return modified_ms;
            }
        }
    }
    0
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
    let note_names = if rel_path == FEED_FOLDER {
        let mut feed_notes = notes
            .into_iter()
            .map(|name| {
                let created_ms = note_created_ms_for_sort(&dir.join(&name));
                (name, created_ms)
            })
            .collect::<Vec<_>>();
        feed_notes.sort_by(|(a_name, a_created), (b_name, b_created)| {
            b_created
                .cmp(a_created)
                .then_with(|| a_name.to_lowercase().cmp(&b_name.to_lowercase()))
        });
        feed_notes.into_iter().map(|(name, _)| name).collect()
    } else {
        sort_by_order(notes, &order.note_order)
    };

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    commands::run();
}
