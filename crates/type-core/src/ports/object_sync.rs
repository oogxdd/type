//! Contracts for syncing a notes root through S3-compatible object storage.
//!
//! The transport ([`ObjectStore`]) is deliberately tiny — five verbs over
//! opaque keys and bytes — so a provider swap never reaches the sync engine,
//! and so the engine can be tested against an in-memory store.

use serde::{Deserialize, Serialize};

use crate::domain::object_sync::{Manifest, ObjectSyncStatus, SyncOutcome};

// ── Settings ───────────────────────────────────────────────────────────────────

/// Device-local connection settings for one profile's bucket.
///
/// Lives in `.type/device.json` beside the git connection: credentials describe
/// how *this device* reaches the bucket and must never travel between devices.
/// The sync scan excludes that file for the same reason.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct ObjectStoreSettings {
    /// Bucket endpoint, e.g. `https://<account>.r2.cloudflarestorage.com`.
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub bucket: String,
    /// Key prefix inside the bucket; defaults to `type-notes/<profile_id>` so
    /// one bucket can hold several working folders.
    #[serde(default)]
    pub prefix: String,
    /// Signing region. `auto` suits R2; S3/B2 want their real region.
    #[serde(default = "default_region")]
    pub region: String,
    #[serde(default)]
    pub access_key_id: String,
    #[serde(default)]
    pub secret_access_key: String,
    /// Force path-style addressing (`endpoint/bucket/key`). `None` auto-detects:
    /// virtual-host for AWS-looking endpoints, path-style everywhere else.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub force_path_style: Option<bool>,
    /// Stable random id for this device; names its manifest in the bucket.
    #[serde(default)]
    pub device_id: String,
    /// Master switch. Credentials can be present while sync is paused.
    #[serde(default)]
    pub enabled: bool,
}

fn default_region() -> String {
    "auto".to_string()
}

impl ObjectStoreSettings {
    /// Enough configuration to attempt a round.
    pub fn is_configured(&self) -> bool {
        !self.endpoint.trim().is_empty()
            && !self.bucket.trim().is_empty()
            && !self.access_key_id.trim().is_empty()
            && !self.secret_access_key.trim().is_empty()
    }

    pub fn is_active(&self) -> bool {
        self.enabled && self.is_configured()
    }

    /// Prefix with any leading/trailing slashes removed, so key joining is
    /// unambiguous.
    pub fn normalized_prefix(&self) -> String {
        self.prefix.trim().trim_matches('/').to_string()
    }

    /// Build a full object key under the configured prefix.
    pub fn key_for(&self, suffix: &str) -> String {
        let prefix = self.normalized_prefix();
        if prefix.is_empty() {
            suffix.to_string()
        } else {
            format!("{prefix}/{suffix}")
        }
    }
}

// ── Transport ──────────────────────────────────────────────────────────────────

/// One entry from a bucket listing.
#[derive(Clone, Debug, PartialEq)]
pub struct ObjectListing {
    pub key: String,
    pub size: u64,
}

/// The blob-store verbs the sync engine needs.
///
/// Implementations are expected to be blocking; the scheduler already runs
/// rounds on its own thread.
pub trait ObjectStore: Send + Sync {
    /// Fetch an object. `Ok(None)` for a missing key — a 404 is an ordinary
    /// answer here (no manifest yet, blob already collected), not an error.
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>, String>;

    /// Upload, overwriting any existing object at `key`.
    fn put(&self, key: &str, body: Vec<u8>, content_type: &str) -> Result<(), String>;

    /// Delete. Succeeds when the key is already absent.
    fn delete(&self, key: &str) -> Result<(), String>;

    /// List every object under `prefix`, following continuation tokens.
    fn list(&self, prefix: &str) -> Result<Vec<ObjectListing>, String>;

    /// Cheap round-trip used by "Test connection" to surface auth and endpoint
    /// mistakes before the first sync.
    fn check_access(&self) -> Result<(), String>;
}

// ── Codec ──────────────────────────────────────────────────────────────────────

/// Turns local content into what actually lands in the bucket.
///
/// Phase 1 is the identity transform. Phase 2 slots encryption in here — object
/// keys become HMACs of the content hash and payloads become AEAD envelopes —
/// without the engine knowing which is in play.
pub trait ObjectCodec: Send + Sync {
    /// Bucket key for a blob, given the hex SHA-256 of its plaintext.
    fn object_key(&self, content_hash: &str) -> String;

    /// Bucket key for one device's manifest.
    fn manifest_key(&self, device_id: &str) -> String;

    /// The prefix every manifest key shares, for listing devices.
    fn manifest_prefix(&self) -> String;

    fn encode_blob(&self, key: &str, plaintext: Vec<u8>) -> Result<Vec<u8>, String>;
    fn decode_blob(&self, key: &str, stored: Vec<u8>) -> Result<Vec<u8>, String>;

    fn encode_manifest(&self, key: &str, manifest: &Manifest) -> Result<Vec<u8>, String>;
    fn decode_manifest(&self, key: &str, stored: Vec<u8>) -> Result<Manifest, String>;

    /// Whether payloads leaving this device are encrypted.
    fn is_encrypted(&self) -> bool {
        false
    }
}

// ── Gateway ────────────────────────────────────────────────────────────────────

/// Application-facing surface for the object-sync domain.
///
/// Public rather than `pub(crate)` because `type-ffi` is a separate crate and
/// drives the same use cases as the Tauri shell — [`crate::ports::git_sync`]
/// is public for the same reason.
pub trait ObjectSyncGateway {
    type Settings;
    type Status;

    fn status(&self) -> Result<Self::Status, String>;
    fn settings(&self) -> Result<Self::Settings, String>;
    fn save_settings(&self, settings: Self::Settings) -> Result<Self::Status, String>;
    fn test_connection(&self, settings: Self::Settings) -> Result<(), String>;
    /// Run a round now, blocking until it finishes.
    fn sync_now(&self) -> Result<SyncOutcome, String>;
    /// Ask the scheduler to run soon; returns immediately.
    fn request_sync(&self, reason: &str) -> Result<(), String>;
    /// Delete blobs no device manifest references any more.
    fn collect_garbage(&self) -> Result<usize, String>;
}

/// Public service contract, mirrored by the Tauri commands and FFI exports.
pub trait ObjectSyncService {
    fn get_status(&self) -> Result<ObjectSyncStatus, String>;
    fn get_settings(&self) -> Result<ObjectStoreSettings, String>;
    fn set_settings(&self, settings: ObjectStoreSettings) -> Result<ObjectSyncStatus, String>;
    fn test_connection(&self, settings: ObjectStoreSettings) -> Result<(), String>;
    fn sync_now(&self) -> Result<SyncOutcome, String>;
    fn request_sync(&self, reason: &str) -> Result<(), String>;
}

// ─── Implementation Notes ─────────────────────────────────────────────────────
//
// The full design, including why blobs are content-addressed and why each
// device writes its own manifest, is in `docs/OBJECT_SYNC.md`. What follows is
// the contract each piece must honor.
//
// Bucket layout
//   <prefix>/repo.json                  format version + encryption mode
//   <prefix>/vault.json                 phase 2: passphrase-wrapped vault key
//   <prefix>/manifests/<device_id>.json one per device, written only by it
//   <prefix>/objects/<object_key>       immutable, content-addressed blobs
//
// ObjectStore
//   - get() must map 404/NoSuchKey to Ok(None); every other non-2xx is an Err
//     carrying the provider's message, since that text is what a user needs to
//     fix a bad key or endpoint.
//   - put() overwrites. Blobs are content-addressed so an overwrite always
//     writes identical bytes; manifests are single-writer per device.
//   - delete() is idempotent — S3 returns 204 for absent keys and callers rely
//     on that (GC races, replayed rounds).
//   - list() must follow continuation tokens to completion. A truncated
//     listing would make GC delete live blobs.
//
// ObjectCodec
//   - object_key() must be deterministic across devices: two devices holding
//     the same note compute the same key, which is what makes dedup and
//     concurrent uploads safe.
//   - decode_blob() must fail loudly on a tag mismatch rather than returning
//     partial data — a corrupt or substituted blob must not reach the notes
//     root.
//
// A sync round
//   1. Load device-local base state (last merged remote view we acted on).
//   2. Scan the notes root into a local manifest, reusing cached hashes for
//      files whose size and mtime are unchanged.
//   3. Fetch every remote manifest and merge them.
//   4. plan_sync(base, local, remote) → actions.
//   5. Execute: upload blobs before publishing the manifest that references
//      them, so no manifest ever points at a missing object.
//   6. Write this device's manifest, then persist the new base.
//
// Interrupting any step is safe: blobs are immutable, the manifest is written
// last, and a partially-applied round simply produces fewer changes for the
// next one to find.
//
// Key assumptions
//   - Credentials are device-local and never enter the synced settings file.
//   - The engine never deletes a local file it has not first seen tombstoned
//     in the merged remote view.
//   - Garbage collection only removes blobs unreferenced by *every* device
//     manifest, and only past a grace period, so a device that has been
//     offline does not lose the blobs it still points at.
