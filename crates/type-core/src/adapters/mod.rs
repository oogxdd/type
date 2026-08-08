// Concrete implementations of the port interfaces.
//
// Each module here implements the contracts defined in `crate::ports` in plain
// Rust (filesystem, git2, crypto, HTTP). Platform-native adapters (Tauri
// windowing, iOS AVAudioRecorder/objc) live in the shells, not here.

pub mod git;
pub mod handwriting;
pub mod import;
pub mod local_sync;
pub mod notes;
pub mod ocr_env;
pub mod profiles;
pub mod recordings;
pub mod security;
pub mod whisper_env;

// Re-export all adapter symbols so the rest of the crate can use them directly.
pub use git::*;
pub use handwriting::*;
pub use import::*;
pub use local_sync::*;
pub use notes::*;
pub use ocr_env::*;
pub use profiles::*;
pub use recordings::*;
pub use security::*;
pub use whisper_env::*;
