//! Object-storage sync: an S3-compatible transport for the notes root.
//!
//! ```text
//!   scheduler.rs  when to sync (debounce, gap, backoff, idle poll)
//!   engine.rs     one round: scan → fetch → diff → apply → publish
//!   manifest.rs   scanning the notes root; device-local state
//!   codec.rs      how keys and payloads are formed (phase 1: as-is)
//!   s3.rs         SigV4 over blocking reqwest
//! ```
//!
//! This hub resolves the active profile, assembles those pieces, and exposes
//! the gateway the application layer drives. See `docs/OBJECT_SYNC.md`.

pub mod codec;
pub mod crypto;
pub mod engine;
pub mod manifest;
pub mod pairing;
pub mod s3;
pub mod scheduler;

use std::path::PathBuf;

use crate::domain::object_sync::{
    ObjectSyncStatus, RepoDescriptor, SyncOutcome, ENCRYPTION_V1,
};
use crate::ports::object_sync::{
    ObjectCodec, ObjectStore, ObjectStoreSettings, ObjectSyncGateway, ObjectSyncService,
};
use crate::AppEnv;

pub use codec::{EncryptedCodec, PlaintextCodec};
pub use crypto::VaultKey;
pub use engine::{RoundResult, SyncEngine, TOMBSTONE_RETENTION_MS};
pub use manifest::{
    build_local_manifest, load_sync_state, save_sync_state, SyncState, MAX_OBJECT_BYTES,
    OBJECT_SYNC_STATE_EXCLUDE_PATTERN,
};
pub use s3::S3ObjectStore;

/// Blobs younger than this are never collected, so a round that has uploaded
/// but not yet published cannot have its objects pulled out from under it.
const GC_MIN_AGE_MS: i64 = 60 * 60 * 1000;

// ── Profile resolution ─────────────────────────────────────────────────────────

/// The active profile's notes root and its bucket settings.
struct ActiveProfile {
    root: PathBuf,
    settings: ObjectStoreSettings,
}

fn active_profile(app: &AppEnv) -> Result<ActiveProfile, String> {
    let root = crate::notes_root(app)?;
    let mut settings = crate::load_object_store_settings(&root);

    // Every device needs a stable id to name its manifest. Minting it lazily
    // keeps it out of the setup flow the user sees.
    if settings.device_id.trim().is_empty() {
        settings.device_id = uuid::Uuid::now_v7().simple().to_string();
        if settings.is_configured() {
            crate::save_object_store_settings(&root, &settings)?;
        }
    }
    if settings.prefix.trim().is_empty() {
        settings.prefix = default_prefix(app);
    }

    Ok(ActiveProfile { root, settings })
}

/// One bucket can hold several working folders, so the prefix is per profile.
fn default_prefix(app: &AppEnv) -> String {
    let profile_id = crate::ensure_profiles_state(app)
        .ok()
        .map(|state| state.active_profile_id)
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| "default".to_string());
    format!("type-notes/{profile_id}")
}

fn build_store(settings: &ObjectStoreSettings) -> Result<Box<dyn ObjectStore>, String> {
    Ok(Box::new(S3ObjectStore::new(settings.clone())?))
}

/// The vault key this device holds for a profile, if any.
fn vault_key_for(root: &std::path::Path) -> Result<Option<VaultKey>, String> {
    match crate::load_object_sync_vault_key(root) {
        Some(encoded) => VaultKey::from_base64(&encoded).map(Some),
        None => Ok(None),
    }
}

const NEEDS_PASSPHRASE: &str =
    "This bucket is end-to-end encrypted. Enter the secret phrase on this device to sync.";

/// Pick the codec the bucket's mode calls for.
fn build_codec(
    settings: &ObjectStoreSettings,
    encrypted: bool,
    vault_key: Option<&VaultKey>,
) -> Result<Box<dyn ObjectCodec>, String> {
    if !encrypted {
        return Ok(Box::new(PlaintextCodec::new(settings)));
    }
    let key = vault_key.ok_or_else(|| NEEDS_PASSPHRASE.to_string())?;
    Ok(Box::new(EncryptedCodec::new(settings, key)))
}

// ── Rounds ─────────────────────────────────────────────────────────────────────

/// Run one round for the active profile. This is what the scheduler calls.
pub fn run_sync_round(app: &AppEnv) -> Result<SyncOutcome, String> {
    let profile = active_profile(app)?;
    if !profile.settings.is_active() {
        return Ok(SyncOutcome::default());
    }

    // Encrypted note bodies would upload as ciphertext without their key, which
    // is harmless, but a locked app cannot safely apply downloads into the
    // notes root either. Wait for unlock instead.
    crate::ensure_security_unlocked_for_app(app)?;

    let store = build_store(&profile.settings)?;
    let vault_key = vault_key_for(&profile.root)?;
    let now_ms = crate::now_ms().unwrap_or(0);

    // Read the bucket's mode first: it decides which codec applies, and a
    // device must never upload plaintext into an encrypted bucket.
    let repo_key = codec::repo_key(&profile.settings);
    let descriptor = engine::ensure_repo_descriptor(
        store.as_ref(),
        &repo_key,
        vault_key.is_some(),
        now_ms,
    )?;
    let codec = build_codec(
        &profile.settings,
        descriptor.is_encrypted(),
        vault_key.as_ref(),
    )?;

    let mut state = load_sync_state(&profile.root);
    if state.remote_encrypted != descriptor.is_encrypted() {
        // The bucket was re-keyed since we last looked. Every object now lives
        // under a different key, so our record of what it holds describes a
        // bucket that no longer exists — and acting on it would read as "every
        // note was deleted remotely". Start over instead: nothing is lost,
        // because identical content converges on its hash.
        state = SyncState {
            remote_encrypted: descriptor.is_encrypted(),
            ..SyncState::default()
        };
    }

    let result = SyncEngine {
        root: &profile.root,
        store: store.as_ref(),
        codec: codec.as_ref(),
        device_id: &profile.settings.device_id,
        repo_key,
    }
    .run_round(state, now_ms)?;
    save_sync_state(&profile.root, &result.state)?;
    Ok(result.outcome)
}

// ── Encryption ─────────────────────────────────────────────────────────────────

/// Turn on end-to-end encryption for this bucket.
///
/// Generates a vault key, wraps it under the passphrase, and rewrites the
/// bucket: every object is re-uploaded under its new opaque key and the old
/// plaintext ones are removed. Local notes are never touched.
///
/// Other devices notice the mode change on their next round and ask for the
/// phrase.
pub fn enable_encryption(app: &AppEnv, passphrase: &str) -> Result<(), String> {
    let profile = active_profile(app)?;
    if !profile.settings.is_configured() {
        return Err("Configure the bucket before enabling encryption.".to_string());
    }
    crate::ensure_security_unlocked_for_app(app)?;

    let store = build_store(&profile.settings)?;
    let repo_key = codec::repo_key(&profile.settings);
    let now_ms = crate::now_ms().unwrap_or(0);

    let existing = engine::ensure_repo_descriptor(store.as_ref(), &repo_key, false, now_ms)?;
    if existing.is_encrypted() {
        return Err(
            "This bucket is already encrypted. Enter its secret phrase to unlock it here."
                .to_string(),
        );
    }

    let vault_key = VaultKey::generate();
    let vault = crypto::wrap_vault_key(passphrase, &vault_key)?;

    // Publish the wrapped key before flipping the mode, so a failure here
    // leaves a plaintext bucket rather than one nobody can unlock.
    let vault_bytes = serde_json::to_vec(&vault).map_err(|error| error.to_string())?;
    store.put(
        &codec::vault_key_object(&profile.settings),
        vault_bytes,
        "application/json",
    )?;

    engine::write_repo_descriptor(
        store.as_ref(),
        &repo_key,
        &RepoDescriptor {
            encryption: ENCRYPTION_V1.to_string(),
            created_ms: existing.created_ms,
            ..RepoDescriptor::default()
        },
    )?;

    // Drop the plaintext objects and manifests. They are unreadable to the new
    // codec anyway, and leaving them would keep readable copies of every note
    // in a bucket the user just asked to encrypt.
    let plaintext = PlaintextCodec::new(&profile.settings);
    for prefix in [plaintext.object_key(""), plaintext.manifest_prefix()] {
        for listing in store.list(&prefix)? {
            store.delete(&listing.key)?;
        }
    }

    crate::save_object_sync_vault_key(&profile.root, Some(vault_key.to_base64()))?;
    // Forget what we knew about the old bucket; the next round re-uploads
    // everything under the new keys.
    save_sync_state(
        &profile.root,
        &SyncState {
            remote_encrypted: true,
            ..SyncState::default()
        },
    )?;

    run_sync_round(app).map(|_| ())
}

/// Adopt an already-encrypted bucket on this device using its secret phrase.
pub fn unlock_encryption(app: &AppEnv, passphrase: &str) -> Result<(), String> {
    let profile = active_profile(app)?;
    if !profile.settings.is_configured() {
        return Err("Configure the bucket first.".to_string());
    }

    let store = build_store(&profile.settings)?;
    let Some(bytes) = store.get(&codec::vault_key_object(&profile.settings))? else {
        return Err(
            "This bucket has no encryption set up. Enable it on a device that already syncs here."
                .to_string(),
        );
    };
    let vault: crypto::VaultFile =
        serde_json::from_slice(&bytes).map_err(|error| format!("Unreadable vault file: {error}"))?;

    let vault_key = crypto::unwrap_vault_key(passphrase, &vault)?;
    adopt_vault_key(app, &vault_key)
}

/// Build the pairing link the desktop renders as a QR.
pub fn build_pairing_link(app: &AppEnv) -> Result<String, String> {
    let profile = active_profile(app)?;
    pairing::build_pairing_link(
        &profile.settings,
        crate::load_object_sync_vault_key(&profile.root),
    )
}

/// Apply a scanned pairing link: bucket settings, and the vault key if the
/// bucket is encrypted.
pub fn apply_pairing_link(app: &AppEnv, link: &str) -> Result<(), String> {
    let profile = active_profile(app)?;
    let scanned = pairing::parse_pairing_link(link, &profile.settings.device_id)?;

    crate::save_object_store_settings(&profile.root, &scanned.settings)?;
    match scanned.vault_key_base64 {
        Some(encoded) => adopt_vault_key(app, &VaultKey::from_base64(&encoded)?)?,
        None => request_object_sync(app, "paired"),
    }
    Ok(())
}

/// Store a vault key obtained out of band — the QR pairing path, where the
/// desktop hands the key to the phone directly and no phrase is typed.
pub fn adopt_vault_key(app: &AppEnv, vault_key: &VaultKey) -> Result<(), String> {
    let profile = active_profile(app)?;
    crate::save_object_sync_vault_key(&profile.root, Some(vault_key.to_base64()))?;

    // Reset for the same reason `run_sync_round` does on a mode change: our
    // base describes the pre-encryption bucket.
    save_sync_state(
        &profile.root,
        &SyncState {
            remote_encrypted: true,
            ..SyncState::default()
        },
    )?;
    request_object_sync(app, "encryption-unlocked");
    Ok(())
}

/// Start the background scheduler. Safe to call more than once.
pub fn start_object_sync(app: &AppEnv) {
    scheduler::install(app.clone(), run_sync_round);
}

/// Ask for a round soon. The cheap call shells make from their triggers.
pub fn request_object_sync(app: &AppEnv, reason: &str) {
    scheduler::install(app.clone(), run_sync_round);
    scheduler::request(reason);
}

// ── Adapter ────────────────────────────────────────────────────────────────────

/// Core gateway for the object-sync domain.
pub struct ObjectSyncAdapter {
    app: AppEnv,
}

impl ObjectSyncAdapter {
    pub fn new(app: AppEnv) -> Self {
        Self { app }
    }

    fn status_impl(&self) -> Result<ObjectSyncStatus, String> {
        let profile = active_profile(&self.app)?;
        let scheduler = scheduler::snapshot();
        let state = load_sync_state(&profile.root);
        let tracked = state
            .base
            .entries
            .values()
            .filter(|entry| !entry.is_deleted())
            .count();
        // Read from the last round's record rather than the bucket: status is
        // polled every few seconds by the settings UI, and a network round-trip
        // per poll would be absurd.
        let has_key = crate::load_object_sync_vault_key(&profile.root).is_some();

        Ok(ObjectSyncStatus {
            configured: profile.settings.is_configured(),
            encrypted: state.remote_encrypted || has_key,
            needs_passphrase: state.remote_encrypted && !has_key,
            syncing: scheduler.running,
            pending: scheduler.dirty,
            last_synced_ms: scheduler.last_synced_ms,
            last_error: scheduler.last_error,
            last_outcome: scheduler.last_outcome,
            device_id: profile.settings.device_id.clone(),
            bucket: profile.settings.bucket.clone(),
            prefix: profile.settings.normalized_prefix(),
            endpoint: profile.settings.endpoint.clone(),
            tracked_files: tracked,
        })
    }

    fn save_settings_impl(
        &self,
        mut settings: ObjectStoreSettings,
    ) -> Result<ObjectSyncStatus, String> {
        let profile = active_profile(&self.app)?;

        // Preserve identity the user never sees: regenerating the device id
        // would orphan this device's manifest and re-upload everything.
        if settings.device_id.trim().is_empty() {
            settings.device_id = profile.settings.device_id.clone();
        }
        if settings.prefix.trim().is_empty() {
            settings.prefix = default_prefix(&self.app);
        }
        if settings.region.trim().is_empty() {
            settings.region = "auto".to_string();
        }

        crate::save_object_store_settings(&profile.root, &settings)?;
        if settings.is_active() {
            request_object_sync(&self.app, "settings");
        }
        self.status_impl()
    }

    fn sync_now_impl(&self) -> Result<SyncOutcome, String> {
        let started_ms = crate::now_ms().unwrap_or(0);
        let result = run_sync_round(&self.app);
        scheduler::record_round(started_ms, &result);
        result
    }

    fn collect_garbage_impl(&self) -> Result<usize, String> {
        let profile = active_profile(&self.app)?;
        if !profile.settings.is_active() {
            return Ok(0);
        }
        let store = build_store(&profile.settings)?;
        let vault_key = vault_key_for(&profile.root)?;
        let state = load_sync_state(&profile.root);
        // GC has to name objects the same way the engine does, so it needs the
        // codec the bucket is actually using.
        let codec = build_codec(&profile.settings, state.remote_encrypted, vault_key.as_ref())?;
        SyncEngine {
            root: &profile.root,
            store: store.as_ref(),
            codec: codec.as_ref(),
            device_id: &profile.settings.device_id,
            repo_key: codec::repo_key(&profile.settings),
        }
        .collect_garbage(crate::now_ms().unwrap_or(0), GC_MIN_AGE_MS)
    }
}

impl ObjectSyncGateway for ObjectSyncAdapter {
    type Settings = ObjectStoreSettings;
    type Status = ObjectSyncStatus;

    fn status(&self) -> Result<Self::Status, String> {
        self.status_impl()
    }

    fn settings(&self) -> Result<Self::Settings, String> {
        Ok(active_profile(&self.app)?.settings)
    }

    fn save_settings(&self, settings: Self::Settings) -> Result<Self::Status, String> {
        self.save_settings_impl(settings)
    }

    fn test_connection(&self, settings: Self::Settings) -> Result<(), String> {
        build_store(&settings)?.check_access()
    }

    fn sync_now(&self) -> Result<SyncOutcome, String> {
        self.sync_now_impl()
    }

    fn request_sync(&self, reason: &str) -> Result<(), String> {
        request_object_sync(&self.app, reason);
        Ok(())
    }

    fn collect_garbage(&self) -> Result<usize, String> {
        self.collect_garbage_impl()
    }

    fn enable_encryption(&self, passphrase: &str) -> Result<Self::Status, String> {
        enable_encryption(&self.app, passphrase)?;
        self.status_impl()
    }

    fn unlock_encryption(&self, passphrase: &str) -> Result<Self::Status, String> {
        unlock_encryption(&self.app, passphrase)?;
        self.status_impl()
    }

    fn pairing_link(&self) -> Result<String, String> {
        build_pairing_link(&self.app)
    }

    fn apply_pairing_link(&self, link: &str) -> Result<Self::Status, String> {
        apply_pairing_link(&self.app, link)?;
        self.status_impl()
    }
}

impl ObjectSyncService for ObjectSyncAdapter {
    fn get_status(&self) -> Result<ObjectSyncStatus, String> {
        self.status_impl()
    }

    fn get_settings(&self) -> Result<ObjectStoreSettings, String> {
        Ok(active_profile(&self.app)?.settings)
    }

    fn set_settings(&self, settings: ObjectStoreSettings) -> Result<ObjectSyncStatus, String> {
        self.save_settings_impl(settings)
    }

    fn test_connection(&self, settings: ObjectStoreSettings) -> Result<(), String> {
        build_store(&settings)?.check_access()
    }

    fn sync_now(&self) -> Result<SyncOutcome, String> {
        self.sync_now_impl()
    }

    fn request_sync(&self, reason: &str) -> Result<(), String> {
        request_object_sync(&self.app, reason);
        Ok(())
    }

    fn enable_encryption(&self, passphrase: &str) -> Result<ObjectSyncStatus, String> {
        enable_encryption(&self.app, passphrase)?;
        self.status_impl()
    }

    fn unlock_encryption(&self, passphrase: &str) -> Result<ObjectSyncStatus, String> {
        unlock_encryption(&self.app, passphrase)?;
        self.status_impl()
    }
}
