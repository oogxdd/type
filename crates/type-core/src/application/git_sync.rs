use crate::ports::git_sync::GitSyncGateway;

/// Git synchronization application boundary.
pub struct GitSyncUseCases<G> {
    gateway: G,
}

impl<G: GitSyncGateway> GitSyncUseCases<G> {
    pub fn new(gateway: G) -> Self {
        Self { gateway }
    }

    pub fn generate_ssh_key(&self) -> Result<String, String> {
        self.gateway.generate_ssh_key()
    }

    pub fn ssh_public_key(&self) -> Result<Option<String>, String> {
        self.gateway.ssh_public_key()
    }

    pub fn delete_ssh_key(&self) -> Result<(), String> {
        self.gateway.delete_ssh_key()
    }

    pub fn status(&self) -> Result<G::Status, String> {
        self.gateway.status()
    }

    pub fn history(&self, args: Option<G::HistoryArgs>) -> Result<Vec<G::History>, String> {
        self.gateway.history(args)
    }

    pub fn connect(&self, args: G::ConnectArgs) -> Result<G::Status, String> {
        self.gateway.connect(args)
    }

    pub fn pull(&self, args: G::PullArgs) -> Result<G::Status, String> {
        self.gateway.pull(args)
    }

    pub fn push(&self, args: G::PushArgs) -> Result<G::Status, String> {
        self.gateway.push(args)
    }
}
