use crate::ports::local_sync::LocalSyncGateway;

/// Application facade for local-network sync server lifecycle and discovery.
pub(crate) struct LocalSyncUseCases<G> {
    gateway: G,
}

impl<G: LocalSyncGateway> LocalSyncUseCases<G> {
    pub(crate) fn new(gateway: G) -> Self {
        Self { gateway }
    }

    pub(crate) fn status(&self) -> Result<G::Status, String> {
        self.gateway.status()
    }

    pub(crate) fn start(&self) -> Result<G::Status, String> {
        self.gateway.start()
    }

    pub(crate) fn stop(&self) -> Result<G::Status, String> {
        self.gateway.stop()
    }

    pub(crate) fn discover(&self, timeout_ms: u64) -> Result<Vec<G::Discovered>, String> {
        self.gateway.discover(timeout_ms)
    }
}
