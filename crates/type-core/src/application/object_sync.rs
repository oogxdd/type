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
}
