use crate::domain::object_sync::SyncOutcome;
use crate::ports::object_sync::ObjectSyncGateway;

/// Object-storage synchronization application boundary.
pub struct ObjectSyncUseCases<G> {
    gateway: G,
}

impl<G: ObjectSyncGateway> ObjectSyncUseCases<G> {
    pub fn new(gateway: G) -> Self {
        Self { gateway }
    }

    pub fn status(&self) -> Result<G::Status, String> {
        self.gateway.status()
    }

    pub fn settings(&self) -> Result<G::Settings, String> {
        self.gateway.settings()
    }

    pub fn save_settings(&self, settings: G::Settings) -> Result<G::Status, String> {
        self.gateway.save_settings(settings)
    }

    pub fn test_connection(&self, settings: G::Settings) -> Result<(), String> {
        self.gateway.test_connection(settings)
    }

    /// Run a round and block until it finishes — the manual "Sync now" path.
    pub fn sync_now(&self) -> Result<SyncOutcome, String> {
        self.gateway.sync_now()
    }

    /// Nudge the scheduler. Returns immediately; this is what editors, screen
    /// transitions, and timers call.
    pub fn request_sync(&self, reason: &str) -> Result<(), String> {
        self.gateway.request_sync(reason)
    }

    pub fn collect_garbage(&self) -> Result<usize, String> {
        self.gateway.collect_garbage()
    }

    /// Turn on end-to-end encryption. Rewrites every object in the bucket
    /// under new keys; local notes are untouched.
    pub fn enable_encryption(&self, passphrase: &str) -> Result<G::Status, String> {
        self.gateway.enable_encryption(passphrase)
    }

    /// Adopt an already-encrypted bucket on this device.
    pub fn unlock_encryption(&self, passphrase: &str) -> Result<G::Status, String> {
        self.gateway.unlock_encryption(passphrase)
    }

    /// The pairing link the desktop renders as a QR. Carries bucket
    /// credentials and the vault key, so it is as sensitive as the bucket.
    pub fn pairing_link(&self) -> Result<String, String> {
        self.gateway.pairing_link()
    }

    pub fn apply_pairing_link(&self, link: &str) -> Result<G::Status, String> {
        self.gateway.apply_pairing_link(link)
    }
}
