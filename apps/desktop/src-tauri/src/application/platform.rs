use crate::ports::platform::PlatformGateway;

/// Platform use cases keep command handlers independent of Objective-C and
/// desktop/mobile conditional compilation.
pub(crate) struct PlatformUseCases<G> {
    gateway: G,
}

impl<G: PlatformGateway> PlatformUseCases<G> {
    pub(crate) fn new(gateway: G) -> Self {
        Self { gateway }
    }

    pub(crate) fn set_native_theme(&self, theme: &str) -> Result<(), String> {
        self.gateway.set_native_theme(theme)
    }

    pub(crate) fn present_file_export_sheet(&self, path: &str) -> Result<(), String> {
        self.gateway.present_file_export_sheet(path)
    }
}
