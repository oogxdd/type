use crate::ports::local_sync::LocalSyncGateway;

/// Application facade for local-network sync server lifecycle and discovery.
pub struct LocalSyncUseCases<G> {
    gateway: G,
}

impl<G: LocalSyncGateway> LocalSyncUseCases<G> {
    pub fn new(gateway: G) -> Self {
        Self { gateway }
    }

    pub fn status(&self) -> Result<G::Status, String> {
        self.gateway.status()
    }

    pub fn start(&self) -> Result<G::Status, String> {
        self.gateway.start()
    }

    pub fn stop(&self) -> Result<G::Status, String> {
        self.gateway.stop()
    }

    pub fn discover(&self, timeout_ms: u64) -> Result<Vec<G::Discovered>, String> {
        self.gateway.discover(timeout_ms)
    }
}
