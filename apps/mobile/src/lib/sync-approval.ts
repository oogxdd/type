import { getErrorMessage } from "@typenotes/shared/errors";

const APPROVAL_REQUIRED_MARKER = "type_sync_approval_required";
const APPROVAL_DECLINED_MARKER = "type_sync_approval_declined";

export type DesktopApprovalRetryOptions = {
  onWaiting: () => void;
  timeoutMs?: number;
  retryMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export const classifyDesktopApprovalError = (
  error: unknown
): "required" | "declined" | null => {
  const message = getErrorMessage(error).toLowerCase();
  if (message.includes(APPROVAL_REQUIRED_MARKER)) {
    return "required";
  }
  if (message.includes(APPROVAL_DECLINED_MARKER)) {
    return "declined";
  }
  return null;
};

export const runWithDesktopApproval = async <T>(
  work: () => Promise<T>,
  options: DesktopApprovalRetryOptions
): Promise<T> => {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + (options.timeoutMs ?? 2 * 60 * 1000);

  while (true) {
    try {
      return await work();
    } catch (error) {
      const approval = classifyDesktopApprovalError(error);
      if (approval === "declined") {
        throw new Error("The sync request was declined on the desktop.");
      }
      if (approval !== "required") {
        throw error;
      }
      if (now() >= deadline) {
        throw new Error("The desktop did not approve the sync request in time.");
      }
      options.onWaiting();
      await sleep(options.retryMs ?? 1500);
    }
  }
};
