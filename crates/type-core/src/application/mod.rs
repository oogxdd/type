// Use-case services. Gated to match `adapters/` — see Cargo.toml `[features]`.

#[cfg(feature = "git-sync")]
pub mod git_sync;
#[cfg(feature = "handwriting")]
pub mod handwriting;
#[cfg(feature = "import")]
pub mod import;
#[cfg(feature = "local-sync")]
pub mod local_sync;
pub mod notes;
pub mod profiles;
#[cfg(feature = "recordings")]
pub mod recordings;
pub mod security;
