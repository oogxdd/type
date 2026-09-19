use crate::domain::mailbox_sync::{MailboxAction, MailboxStatus};
/// Device-local configuration, secret pairing export, and a complete encrypted
/// mailbox exchange. Implementations must never hand the vault key to the peer.
pub trait MailboxGateway {
    fn execute(&self, action: MailboxAction) -> Result<MailboxStatus, String>;
}
