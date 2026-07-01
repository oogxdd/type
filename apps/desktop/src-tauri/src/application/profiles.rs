use crate::ports::profiles::ProfilesGateway;

/// Profile use cases are shell-independent; the gateway owns persistence and
/// platform directory access.
pub(crate) struct ProfilesUseCases<G> {
    gateway: G,
}

impl<G: ProfilesGateway> ProfilesUseCases<G> {
    pub(crate) fn new(gateway: G) -> Self {
        Self { gateway }
    }

    pub(crate) fn list(&self) -> Result<G::Snapshot, String> {
        self.gateway.list()
    }

    pub(crate) fn create(&self, args: G::CreateArgs) -> Result<G::Snapshot, String> {
        self.gateway.create(args)
    }

    pub(crate) fn set_active(&self, args: G::SetActiveArgs) -> Result<G::Snapshot, String> {
        self.gateway.set_active(args)
    }

    pub(crate) fn set_notes_root(&self, args: G::SetNotesRootArgs) -> Result<G::Snapshot, String> {
        self.gateway.set_notes_root(args)
    }

    pub(crate) fn update(&self, args: G::UpdateArgs) -> Result<G::Snapshot, String> {
        self.gateway.update(args)
    }

    pub(crate) fn delete(&self, args: G::DeleteArgs) -> Result<G::Snapshot, String> {
        self.gateway.delete(args)
    }

    pub(crate) fn update_settings(&self, args: G::UpdateSettingsArgs) -> Result<G::Snapshot, String> {
        self.gateway.update_settings(args)
    }

    pub(crate) fn update_app_config(&self, args: G::UpdateAppConfigArgs) -> Result<G::Snapshot, String> {
        self.gateway.update_app_config(args)
    }

    pub(crate) fn create_backup(&self) -> Result<G::Backup, String> {
        self.gateway.create_backup()
    }

    pub(crate) fn export_to_documents(&self) -> Result<G::Export, String> {
        self.gateway.export_to_documents()
    }
}
