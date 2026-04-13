// ── Trait ──────────────────────────────────────────────────────────────────────

pub trait PlatformService {
    fn set_native_theme(&self, theme: &str) -> Result<(), String>;
    fn present_file_export_sheet(&self, path: &str) -> Result<(), String>;
}

// ─── Implementation Notes ─────────────────────────────────────────────────────
//
// PlatformService wraps OS-specific native features that differ per target platform.
// Each target (iOS, macOS, Android, desktop) provides its own implementation.
// Unsupported operations return a descriptive error rather than silently no-op.
//
// set_native_theme(theme)
//   in:  theme — "light", "dark", or "system"
//   out: nothing
//   - iOS: overrides UIUserInterfaceStyle on the root view controller and WKWebView
//   - macOS: may adjust NSWindow appearance
//   - Other platforms: no-op (returns Ok)
//
// present_file_export_sheet(path)
//   in:  path — absolute path to the file to export
//   out: nothing
//   - iOS: presents a UIDocumentPickerViewController for the file
//   - Other platforms: returns an error ("unavailable on this platform")
//
// Key assumptions for any implementation:
//   - Platform-specific code is isolated behind this trait
//   - iOS uses Objective-C interop (objc crate) for native APIs
//   - macOS uses NSWindow APIs for transparency and appearance
//   - Implementations should handle interruption recovery (e.g. audio session interruptions on iOS)
//   - The WKWebView crash recovery (auto-reload on webViewWebContentProcessDidTerminate)
//     is handled at the app lifecycle level, not through this trait
