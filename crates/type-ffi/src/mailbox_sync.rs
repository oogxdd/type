use crate::{from_json, run_blocking, to_json, unlocked_env, CoreError};
use type_core::{
    adapters::mailbox_sync::MailboxAdapter, application::mailbox_sync::MailboxUseCases,
    domain::mailbox_sync::MailboxAction,
};

#[uniffi::export(async_runtime = "tokio")]
pub async fn mailbox_sync(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: MailboxAction = from_json(&args_json)?;
        to_json(&MailboxUseCases::new(MailboxAdapter::new(unlocked_env()?)).execute(args)?)
    })
    .await
}
