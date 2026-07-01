use crate::ports::recordings::RecordingsGateway;

/// Recording and transcription application boundary.
pub struct RecordingsUseCases<G> {
    gateway: G,
}

impl<G: RecordingsGateway> RecordingsUseCases<G> {
    pub fn new(gateway: G) -> Self {
        Self { gateway }
    }

    pub fn native_capabilities(&self) -> Result<G::NativeCapabilities, String> {
        self.gateway.native_capabilities()
    }

    pub fn start_native(&self) -> Result<(), String> {
        self.gateway.start_native()
    }

    pub fn stop_native(&self) -> Result<G::AudioPayload, String> {
        self.gateway.stop_native()
    }

    pub fn save(&self, args: G::SaveArgs) -> Result<G::WriteResult, String> {
        self.gateway.save(args)
    }

    pub fn queue_cloud(&self, args: G::CloudQueueArgs) -> Result<G::QueueResult, String> {
        self.gateway.queue_cloud(args)
    }

    pub fn queue_local(&self, args: G::LocalQueueArgs) -> Result<G::QueueResult, String> {
        self.gateway.queue_local(args)
    }

    pub fn retrigger(&self, args: G::RetriggerArgs) -> Result<(), String> {
        self.gateway.retrigger(args)
    }

    pub fn whisper_status(&self, args: G::WhisperArgs) -> G::WhisperStatus {
        self.gateway.whisper_status(args)
    }

    pub fn list(&self) -> Result<G::ListResult, String> {
        self.gateway.list()
    }

    pub fn read_audio(&self, args: G::ReadArgs) -> Result<G::AudioPayload, String> {
        self.gateway.read_audio(args)
    }
}
