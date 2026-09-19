use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum MailboxAction {
    Status,
    Configure { secret_code: String },
    Pairing,
    Sync,
    Disconnect,
}
#[derive(Serialize)]
pub struct MailboxStatus {
    pub enabled: bool,
    pub endpoint: Option<String>,
    pub revision: u64,
    pub last_sync_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pairing_secret: Option<String>,
}
