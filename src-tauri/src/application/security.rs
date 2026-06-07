use crate::ports::security::SecurityGateway;

/// Application boundary for lock and encryption use cases.
pub(crate) struct SecurityUseCases<G> {
    gateway: G,
}

impl<G: SecurityGateway> SecurityUseCases<G> {
    pub(crate) fn new(gateway: G) -> Self {
        Self { gateway }
    }

    pub(crate) fn state(&self) -> Result<G::State, String> {
        self.gateway.state()
    }

    pub(crate) fn enable(&self, args: G::EnableArgs) -> Result<G::State, String> {
        self.gateway.enable(args)
    }

    pub(crate) fn lock(&self) -> Result<G::State, String> {
        self.gateway.lock()
    }

    pub(crate) fn unlock(&self, args: G::UnlockArgs) -> Result<G::UnlockResult, String> {
        self.gateway.unlock(args)
    }

    pub(crate) fn set_preferences(&self, args: G::PreferencesArgs) -> Result<G::State, String> {
        self.gateway.set_preferences(args)
    }
}
