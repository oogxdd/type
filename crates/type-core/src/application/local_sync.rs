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

    pub fn start_request_listener(&self) -> Result<G::Status, String> {
        self.gateway.start_request_listener()
    }

    pub fn open_window(&self) -> Result<G::Status, String> {
        self.gateway.open_window()
    }

    pub fn close_window(&self) -> Result<G::Status, String> {
        self.gateway.close_window()
    }

    pub fn approve(&self) -> Result<G::Status, String> {
        self.gateway.approve()
    }

    pub fn decline(&self) -> Result<G::Status, String> {
        self.gateway.decline()
    }

    pub fn stop(&self) -> Result<G::Status, String> {
        self.gateway.stop()
    }

    pub fn discover(&self, timeout_ms: u64) -> Result<Vec<G::Discovered>, String> {
        self.gateway.discover(timeout_ms)
    }
}
