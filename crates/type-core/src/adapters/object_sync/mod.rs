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
pub mod engine;
pub mod manifest;
pub mod s3;
pub mod scheduler;

use std::path::PathBuf;

use crate::domain::object_sync::{ObjectSyncStatus, SyncOutcome};
use crate::ports::object_sync::{
    ObjectCodec, ObjectStore, ObjectStoreSettings, ObjectSyncGateway, ObjectSyncService,
};
use crate::AppEnv;

pub use codec::PlaintextCodec;
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

/// Phase 1 always uses the plaintext codec; phase 2 chooses here based on the
/// bucket's `repo.json` and whether this device holds the vault key.
fn build_codec(settings: &ObjectStoreSettings) -> Box<dyn ObjectCodec> {
    Box::new(PlaintextCodec::new(settings))
}

// ── Rounds ─────────────────────────────────────────────────────────────────────

/// Run one round for the active profile. This is what the scheduler calls.
pub fn run_sync_round(app: &AppEnv) -> Result<SyncOutcome, String> {
    let profile = active_profile(app)?;
    if !profile.settings.is_active() {
        return Ok(SyncOutcome::default());
    }

    // Encrypted note bodies would be uploaded as ciphertext without their key,
    // which is fine, but a locked app cannot safely apply downloads into the
    // notes root either. Wait for unlock instead.
    crate::ensure_security_unlocked_for_app(app)?;

    let store = build_store(&profile.settings)?;
    let codec = build_codec(&profile.settings);
    let engine = SyncEngine {
        root: &profile.root,
        store: store.as_ref(),
        codec: codec.as_ref(),
        device_id: &profile.settings.device_id,
        repo_key: codec::repo_key(&profile.settings),
    };

    let now_ms = crate::now_ms().unwrap_or(0);
    let descriptor = engine.ensure_repo_descriptor(now_ms)?;
    if descriptor.is_encrypted() && !codec.is_encrypted() {
        return Err(
            "This bucket is end-to-end encrypted. Enter the secret phrase on this device to sync."
                .to_string(),
        );
    }

    let state = load_sync_state(&profile.root);
    let result = engine.run_round(state, now_ms)?;
    save_sync_state(&profile.root, &result.state)?;
    Ok(result.outcome)
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
        let tracked = load_sync_state(&profile.root)
            .base
            .entries
            .values()
            .filter(|entry| !entry.is_deleted())
            .count();

        Ok(ObjectSyncStatus {
            configured: profile.settings.is_configured(),
            encrypted: false,
            needs_passphrase: false,
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
        let codec = build_codec(&profile.settings);
        let engine = SyncEngine {
            root: &profile.root,
            store: store.as_ref(),
            codec: codec.as_ref(),
            device_id: &profile.settings.device_id,
            repo_key: codec::repo_key(&profile.settings),
        };
        engine.collect_garbage(crate::now_ms().unwrap_or(0), GC_MIN_AGE_MS)
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
}
