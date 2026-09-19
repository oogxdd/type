use type_core::{
    adapters::mailbox_sync::MailboxAdapter,
    application::mailbox_sync::MailboxUseCases,
    domain::mailbox_sync::{MailboxAction, MailboxStatus},
};

#[tauri::command]
pub(super) async fn mailbox_sync(
    app: tauri::AppHandle,
    args: MailboxAction,
) -> Result<MailboxStatus, String> {
    let env = crate::app_env(&app)?;
    super::run_blocking_command(move || {
        MailboxUseCases::new(MailboxAdapter::new(env)).execute(args)
    })
    .await
}
