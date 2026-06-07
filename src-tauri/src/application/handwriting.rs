use crate::ports::handwriting::HandwritingGateway;

/// Handwriting attachment and OCR application boundary.
pub(crate) struct HandwritingUseCases<G> {
    gateway: G,
}

impl<G: HandwritingGateway> HandwritingUseCases<G> {
    pub(crate) fn new(gateway: G) -> Self {
        Self { gateway }
    }

    pub(crate) fn save(&self, args: G::SaveArgs) -> Result<G::WriteResult, String> {
        self.gateway.save(args)
    }

    pub(crate) fn queue(&self, args: G::QueueArgs) -> Result<G::QueueResult, String> {
        self.gateway.queue(args)
    }

    pub(crate) fn list(&self) -> Result<G::ListResult, String> {
        self.gateway.list()
    }
}
