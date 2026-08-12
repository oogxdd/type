use crate::ports::profiles::ProfilesGateway;

/// Profile use cases are shell-independent; the gateway owns persistence and
/// platform directory access.
pub struct ProfilesUseCases<G> {
    gateway: G,
}

impl<G: ProfilesGateway> ProfilesUseCases<G> {
    pub fn new(gateway: G) -> Self {
        Self { gateway }
    }

    pub fn list(&self) -> Result<G::Snapshot, String> {
        self.gateway.list()
    }

    pub fn create(&self, args: G::CreateArgs) -> Result<G::Snapshot, String> {
        self.gateway.create(args)
    }

    pub fn set_active(&self, args: G::SetActiveArgs) -> Result<G::Snapshot, String> {
        self.gateway.set_active(args)
    }

    pub fn set_notes_root(&self, args: G::SetNotesRootArgs) -> Result<G::Snapshot, String> {
        self.gateway.set_notes_root(args)
    }

    pub fn update(&self, args: G::UpdateArgs) -> Result<G::Snapshot, String> {
        self.gateway.update(args)
    }

    pub fn delete(&self, args: G::DeleteArgs) -> Result<G::Snapshot, String> {
        self.gateway.delete(args)
    }

    pub fn update_settings(&self, args: G::UpdateSettingsArgs) -> Result<G::Snapshot, String> {
        self.gateway.update_settings(args)
    }

    pub fn update_app_config(&self, args: G::UpdateAppConfigArgs) -> Result<G::Snapshot, String> {
        self.gateway.update_app_config(args)
    }

    #[cfg(feature = "profile-backup")]
    pub fn create_backup(&self) -> Result<G::Backup, String> {
        self.gateway.create_backup()
    }

    #[cfg(feature = "profile-backup")]
    pub fn export_to_documents(&self) -> Result<G::Export, String> {
        self.gateway.export_to_documents()
    }
}
