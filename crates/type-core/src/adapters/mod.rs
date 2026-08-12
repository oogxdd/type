// Concrete implementations of the port interfaces.
//
// Each module here implements the contracts defined in `crate::ports` in plain
// Rust (filesystem, git2, crypto, HTTP). Platform-native adapters (Tauri
// windowing, iOS AVAudioRecorder/objc) live in the shells, not here.
//
// The `#[cfg(feature = …)]` gates let a lean shell compile only the domains it
// uses — see the `[features]` block in Cargo.toml. `notes`, `profiles`, and
// `security` are unconditional: they carry no heavy dependencies and every
// other domain builds on them.

#[cfg(feature = "git-sync")]
pub mod git;
#[cfg(feature = "handwriting")]
pub mod handwriting;
#[cfg(feature = "import")]
pub mod import;
#[cfg(feature = "local-sync")]
pub mod local_sync;
pub mod notes;
#[cfg(feature = "handwriting")]
pub mod ocr_env;
pub mod profiles;
#[cfg(feature = "recordings")]
pub mod recordings;
pub mod security;
#[cfg(feature = "recordings")]
pub mod whisper_env;

// Re-export all adapter symbols so the rest of the crate can use them directly.
#[cfg(feature = "git-sync")]
pub use git::*;
#[cfg(feature = "handwriting")]
pub use handwriting::*;
#[cfg(feature = "import")]
pub use import::*;
#[cfg(feature = "local-sync")]
pub use local_sync::*;
pub use notes::*;
#[cfg(feature = "handwriting")]
pub use ocr_env::*;
pub use profiles::*;
#[cfg(feature = "recordings")]
pub use recordings::*;
pub use security::*;
#[cfg(feature = "recordings")]
pub use whisper_env::*;
