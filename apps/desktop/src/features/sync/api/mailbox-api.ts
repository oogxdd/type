import type { MailboxAction, MailboxStatus } from "@typenotes/shared/types";
import { invokeLogged } from "@/shared/api/invoke";

export const mailboxSync = (args: MailboxAction): Promise<MailboxStatus> =>
  invokeLogged("mailbox_sync", { args });
