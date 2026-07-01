use crate::ports::git_sync::GitSyncGateway;

/// Git synchronization application boundary.
pub(crate) struct GitSyncUseCases<G> {
    gateway: G,
}

impl<G: GitSyncGateway> GitSyncUseCases<G> {
    pub(crate) fn new(gateway: G) -> Self {
        Self { gateway }
    }

    pub(crate) fn generate_ssh_key(&self) -> Result<String, String> {
        self.gateway.generate_ssh_key()
    }

    pub(crate) fn ssh_public_key(&self) -> Result<Option<String>, String> {
        self.gateway.ssh_public_key()
    }

    pub(crate) fn delete_ssh_key(&self) -> Result<(), String> {
        self.gateway.delete_ssh_key()
    }

    pub(crate) fn status(&self) -> Result<G::Status, String> {
        self.gateway.status()
    }

    pub(crate) fn history(&self, args: Option<G::HistoryArgs>) -> Result<Vec<G::History>, String> {
        self.gateway.history(args)
    }

    pub(crate) fn connect(&self, args: G::ConnectArgs) -> Result<G::Status, String> {
        self.gateway.connect(args)
    }

    pub(crate) fn pull(&self, args: G::PullArgs) -> Result<G::Status, String> {
        self.gateway.pull(args)
    }

    pub(crate) fn push(&self, args: G::PushArgs) -> Result<G::Status, String> {
        self.gateway.push(args)
    }
}
