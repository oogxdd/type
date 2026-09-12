use crate::{from_json, run_blocking, to_json, unlocked_env, CoreError};
use type_core::{
    adapters::tag_registry::FilesystemTagRegistry, application::tag_registry::TagRegistryService,
    notes_root,
};
#[uniffi::export(async_runtime = "tokio")]
pub async fn read_tag_registry() -> Result<String, CoreError> {
    run_blocking(|| {
        to_json(&TagRegistryService(FilesystemTagRegistry(notes_root(&unlocked_env()?)?)).read()?)
    })
    .await
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn write_tag_registry(registry_json: String) -> Result<(), CoreError> {
    run_blocking(move || {
        TagRegistryService(FilesystemTagRegistry(notes_root(&unlocked_env()?)?))
            .write(from_json(&registry_json)?)
    })
    .await
}
