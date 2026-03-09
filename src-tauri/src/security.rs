// Encryption, password hashing, and lock-mode management.

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
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use zeroize::Zeroize;

use crate::{
    app_data_dir, collect_markdown_note_files, default_profiles_state, ensure_profiles_state,
    ensure_system_folders, find_profile, generate_note_id, legacy_profiles_file_path, now_ms,
    parse_note_front_matter, profiles_file_path, render_note_with_front_matter,
    write_profiles_state, NoteFrontMatter, NotesProfilesFile, FEED_FOLDER,
};

// ── Constants ──────────────────────────────────────────────────────────────────

const SECURITY_FILE: &str = ".notes-security.json";
const SECURITY_NOTE_BODY_PREFIX: &str = "NV_ENC_V1:";
const SECURITY_KEY_SIZE: usize = 32;
const SECURITY_NONCE_SIZE: usize = 24;
const SECURITY_SALT_SIZE: usize = 16;
const SECURITY_LOCKED_ERROR: &str = "Notes are locked. Unlock the app first.";

// ── Types ──────────────────────────────────────────────────────────────────────

/// Persisted security configuration (password hashes, salt, preferences).
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

/// In-memory runtime state: loaded config, lock status, derived key.
#[derive(Default)]
struct SecurityRuntimeState {
    loaded: bool,
    config: SecurityConfigFile,
    locked: bool,
    key: Option<[u8; SECURITY_KEY_SIZE]>,
}

/// Snapshot returned to the frontend.
#[derive(Serialize)]
pub(crate) struct SecurityState {
    pub(crate) encryption_enabled: bool,
    pub(crate) locked: bool,
    pub(crate) auto_lock_on_background: bool,
}

#[derive(Deserialize)]
pub(crate) struct EnableSecurityArgs {
    pub(crate) unlock_password: String,
    pub(crate) panic_password: String,
}

#[derive(Deserialize)]
pub(crate) struct UnlockSecurityArgs {
    pub(crate) password: String,
}

#[derive(Deserialize)]
pub(crate) struct SetSecurityPreferencesArgs {
    pub(crate) auto_lock_on_background: bool,
}

#[derive(Serialize)]
pub(crate) struct SecurityUnlockResult {
    pub(crate) unlocked: bool,
    pub(crate) panic_triggered: bool,
    pub(crate) reset_required: bool,
    pub(crate) message: Option<String>,
}

// ── Static ─────────────────────────────────────────────────────────────────────

static SECURITY_RUNTIME: OnceLock<Mutex<SecurityRuntimeState>> = OnceLock::new();

// ── Internal helpers ───────────────────────────────────────────────────────────

fn security_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(SECURITY_FILE))
}

fn security_runtime_state() -> &'static Mutex<SecurityRuntimeState> {
    SECURITY_RUNTIME.get_or_init(|| Mutex::new(SecurityRuntimeState::default()))
}

/// Zeroize the old key before replacing it.
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
    let parsed = serde_json::from_str::<SecurityConfigFile>(&raw)
        .unwrap_or_else(|_| SecurityConfigFile::default());
    Ok(parsed)
}

fn write_security_config(
    app: &tauri::AppHandle,
    config: &SecurityConfigFile,
) -> Result<(), String> {
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

// ── Password / key derivation ──────────────────────────────────────────────────

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

// ── Note body encryption / decryption ──────────────────────────────────────────

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
    Ok(format!(
        "{}{}",
        SECURITY_NOTE_BODY_PREFIX,
        BASE64.encode(payload)
    ))
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

/// Decrypt an encrypted note body using the runtime key (returns as-is if not encrypted).
pub(crate) fn decrypt_note_body_for_read(body: &str) -> Result<String, String> {
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

/// Encrypt a note body for writing (no-op if encryption is disabled).
pub(crate) fn encrypt_note_body_for_write(body: &str) -> Result<String, String> {
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

// ── Lock gate ──────────────────────────────────────────────────────────────────

/// Reject operations when the app is locked.
pub(crate) fn ensure_security_unlocked_for_app(app: &tauri::AppHandle) -> Result<(), String> {
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

// ── Migration helpers ──────────────────────────────────────────────────────────

/// Collect unique notes roots across all profiles.
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

/// Encrypt all plaintext note bodies in a root directory.
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

/// Seed a reset root with sample notes so the user has something to see.
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

/// Panic-password triggered: wipe all profile data and reset to defaults.
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

// ── Public command implementations ─────────────────────────────────────────────

/// Called during app setup to load security config from disk.
pub(crate) fn ensure_security_runtime_initialized_for_setup(
    app: &tauri::AppHandle,
) -> Result<(), String> {
    ensure_security_runtime_loaded(app)
}

pub(crate) fn get_security_state_impl(app: &tauri::AppHandle) -> Result<SecurityState, String> {
    security_state_snapshot(app)
}

/// Enable encryption: hash passwords, derive key, encrypt all existing notes.
pub(crate) fn enable_security_impl(
    app: &tauri::AppHandle,
    args: EnableSecurityArgs,
) -> Result<SecurityState, String> {
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

pub(crate) fn lock_security_impl(app: &tauri::AppHandle) -> Result<SecurityState, String> {
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

/// Verify password; if panic password matches, wipe all data.
pub(crate) fn unlock_security_impl(
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

pub(crate) fn set_security_preferences_impl(
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
