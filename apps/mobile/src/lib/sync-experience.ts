export type AutoSyncState =
  | "saved_locally"
  | "syncing"
  | "waiting_for_computer"
  | "synced"
  | "uploaded_to_peer"
  | "waiting_for_peer";

const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000, 60_000, 5 * 60_000] as const;

/** Retry quickly while a nearby Mac wakes, then settle into a battery-safe poll. */
export const autoSyncRetryDelayMs = (failureCount: number): number => {
  const index = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, failureCount - 1));
  return RETRY_DELAYS_MS[index];
};

export const autoSyncLabel = (state: AutoSyncState | null): string | null => {
  switch (state) {
    case "saved_locally":
      return "Saved locally";
    case "syncing":
      return "Syncing…";
    case "waiting_for_computer":
      return "Waiting for computer";
    case "uploaded_to_peer":
      return "Uploaded to peer";
    case "waiting_for_peer":
      return "Waiting for sync peer";
    case "synced":
      return "Synced";
    default:
      return null;
  }
};

export const saveReasonHasLocalChanges = (reason: string): boolean =>
  /saved|deleted/i.test(reason);

/** Git success does not mean the separate audio transfer has finished. */
export const audioSyncLabel = (state: "archiving" | "done" | "error" | null): string => {
  switch (state) {
    case "archiving": return "Transferring — keep Type open";
    case "done": return "Transferred";
    case "error": return "Not finished — retry Sync";
    default: return "Not checked this session";
  }
};
