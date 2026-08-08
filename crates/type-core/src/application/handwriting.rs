use crate::ports::handwriting::HandwritingGateway;

/// Handwriting attachment and OCR application boundary.
pub struct HandwritingUseCases<G> {
    gateway: G,
}

impl<G: HandwritingGateway> HandwritingUseCases<G> {
    pub fn new(gateway: G) -> Self {
        Self { gateway }
    }

    pub fn save(&self, args: G::SaveArgs) -> Result<G::WriteResult, String> {
        self.gateway.save(args)
    }

    pub fn queue(&self, args: G::QueueArgs) -> Result<G::QueueResult, String> {
        self.gateway.queue(args)
    }

    pub fn list(&self) -> Result<G::ListResult, String> {
        self.gateway.list()
    }

    pub fn local_status(&self, args: G::LocalStatusArgs) -> G::LocalStatus {
        self.gateway.local_status(args)
    }
}
