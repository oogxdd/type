// Rust/Tauri implementations of the port interfaces.
//
// Each module here implements the contracts defined in `crate::ports`.
// These are the concrete adapters — when migrating to another platform,
// replace these files with equivalent implementations in the target language.

pub(crate) mod git;
pub(crate) mod handwriting;
pub(crate) mod import;
pub(crate) mod local_sync;
pub(crate) mod notes;
pub(crate) mod platform;
pub(crate) mod profiles;
pub(crate) mod recordings;
pub(crate) mod security;
pub(crate) mod whisper_env;

#[cfg(target_os = "ios")]
pub(crate) mod ios;

// Re-export all adapter symbols so the rest of the crate can use them directly.
pub(crate) use git::*;
pub(crate) use handwriting::*;
pub(crate) use import::*;
pub(crate) use local_sync::*;
pub(crate) use notes::*;
pub(crate) use platform::*;
pub(crate) use profiles::*;
pub(crate) use recordings::*;
pub(crate) use security::*;
pub(crate) use whisper_env::*;

#[cfg(target_os = "ios")]
pub(crate) use ios::*;
