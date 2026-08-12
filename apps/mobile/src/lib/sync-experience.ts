export type AutoSyncState =
  | "saved_locally"
  | "syncing"
  | "waiting_for_computer"
  | "synced";

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
    case "synced":
      return "Synced";
    default:
      return null;
  }
};

export const saveReasonHasLocalChanges = (reason: string): boolean =>
  /saved|deleted/i.test(reason);
