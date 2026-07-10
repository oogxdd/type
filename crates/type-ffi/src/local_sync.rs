//! Mobile-facing local-network discovery. Phones never host the SSH server,
//! but they browse its mDNS advertisement to find a paired desktop.

use crate::{run_blocking, to_json, unlocked_env, CoreError};

/// Browse for nearby Type desktop listeners. Returns JSON `Vec<DiscoveredServer>`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn discover_local_sync_servers(timeout_ms: Option<u32>) -> Result<String, CoreError> {
    run_blocking(move || {
        let _ = unlocked_env()?;
        let servers =
            type_core::discover_local_sync_servers_impl(u64::from(timeout_ms.unwrap_or(2500)))?;
        to_json(&servers)
    })
    .await
}
