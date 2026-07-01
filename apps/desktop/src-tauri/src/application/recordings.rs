use crate::ports::recordings::RecordingsGateway;

/// Recording and transcription application boundary.
pub(crate) struct RecordingsUseCases<G> {
    gateway: G,
}

impl<G: RecordingsGateway> RecordingsUseCases<G> {
    pub(crate) fn new(gateway: G) -> Self {
        Self { gateway }
    }

    pub(crate) fn native_capabilities(&self) -> Result<G::NativeCapabilities, String> {
        self.gateway.native_capabilities()
    }

    pub(crate) fn start_native(&self) -> Result<(), String> {
        self.gateway.start_native()
    }

    pub(crate) fn stop_native(&self) -> Result<G::AudioPayload, String> {
        self.gateway.stop_native()
    }

    pub(crate) fn save(&self, args: G::SaveArgs) -> Result<G::WriteResult, String> {
        self.gateway.save(args)
    }

    pub(crate) fn queue_cloud(&self, args: G::CloudQueueArgs) -> Result<G::QueueResult, String> {
        self.gateway.queue_cloud(args)
    }

    pub(crate) fn queue_local(&self, args: G::LocalQueueArgs) -> Result<G::QueueResult, String> {
        self.gateway.queue_local(args)
    }

    pub(crate) fn retrigger(&self, args: G::RetriggerArgs) -> Result<(), String> {
        self.gateway.retrigger(args)
    }

    pub(crate) fn whisper_status(&self, args: G::WhisperArgs) -> G::WhisperStatus {
        self.gateway.whisper_status(args)
    }

    pub(crate) fn list(&self) -> Result<G::ListResult, String> {
        self.gateway.list()
    }

    pub(crate) fn read_audio(&self, args: G::ReadArgs) -> Result<G::AudioPayload, String> {
        self.gateway.read_audio(args)
    }
}
