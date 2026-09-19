use crate::{
    domain::mailbox_sync::{MailboxAction, MailboxStatus},
    ports::mailbox_sync::MailboxGateway,
};
pub struct MailboxUseCases<G: MailboxGateway>(G);
impl<G: MailboxGateway> MailboxUseCases<G> {
    pub fn new(gateway: G) -> Self {
        Self(gateway)
    }
    pub fn execute(&self, action: MailboxAction) -> Result<MailboxStatus, String> {
        self.0.execute(action)
    }
}
