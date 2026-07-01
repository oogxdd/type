use crate::ports::import::ImportGateway;

/// Coordinates import use cases while the adapter owns source scanning and the
/// background worker implementation.
pub struct ImportUseCases<G> {
    gateway: G,
}

impl<G: ImportGateway> ImportUseCases<G> {
    pub fn new(gateway: G) -> Self {
        Self { gateway }
    }

    pub fn scan(&self, path: &str) -> Result<G::Scan, String> {
        self.gateway.scan(path)
    }

    pub fn start(&self, args: G::Args) -> Result<(), String> {
        self.gateway.start(args)
    }

    pub fn status(&self) -> Result<G::State, String> {
        self.gateway.status()
    }
}
