// Tauri/Objective-C adapters that must stay in the shell. Everything
// platform-agnostic (filesystem notes, profiles, security, git, queues, …)
// lives in the type-core crate.

pub(crate) mod platform;
pub(crate) mod recordings;

#[cfg(target_os = "ios")]
pub(crate) mod ios;

pub(crate) use platform::*;
pub(crate) use recordings::*;

#[cfg(target_os = "ios")]
pub(crate) use ios::*;
