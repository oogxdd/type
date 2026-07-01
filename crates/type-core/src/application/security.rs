use crate::ports::security::SecurityGateway;

/// Application boundary for lock and encryption use cases.
pub struct SecurityUseCases<G> {
    gateway: G,
}

impl<G: SecurityGateway> SecurityUseCases<G> {
    pub fn new(gateway: G) -> Self {
        Self { gateway }
    }

    pub fn state(&self) -> Result<G::State, String> {
        self.gateway.state()
    }

    pub fn enable(&self, args: G::EnableArgs) -> Result<G::State, String> {
        self.gateway.enable(args)
    }

    pub fn lock(&self) -> Result<G::State, String> {
        self.gateway.lock()
    }

    pub fn unlock(&self, args: G::UnlockArgs) -> Result<G::UnlockResult, String> {
        self.gateway.unlock(args)
    }

    pub fn set_preferences(&self, args: G::PreferencesArgs) -> Result<G::State, String> {
        self.gateway.set_preferences(args)
    }
}
