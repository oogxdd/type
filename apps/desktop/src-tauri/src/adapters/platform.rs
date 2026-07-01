use crate::ports::platform::PlatformGateway;

/// Native platform adapter used by the application service.
pub(crate) struct TauriPlatformAdapter {
    app: tauri::AppHandle,
}

impl TauriPlatformAdapter {
    pub(crate) fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl PlatformGateway for TauriPlatformAdapter {
    fn set_native_theme(&self, theme: &str) -> Result<(), String> {
        #[cfg(target_os = "ios")]
        {
            return crate::set_ios_native_theme(&self.app, theme);
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = (&self.app, theme);
            Ok(())
        }
    }

    fn present_file_export_sheet(&self, path: &str) -> Result<(), String> {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return Err("Export path is required.".to_string());
        }
        #[cfg(target_os = "ios")]
        {
            return crate::present_ios_file_export_sheet(&self.app, trimmed);
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = &self.app;
            Err("The native file export sheet is only available on iOS.".to_string())
        }
    }
}
