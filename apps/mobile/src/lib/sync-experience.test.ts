import { describe, expect, it } from "vitest";

import {
  autoSyncLabel,
  autoSyncRetryDelayMs,
  saveReasonHasLocalChanges,
} from "./sync-experience";

describe("sync experience", () => {
  it("backs off quickly and caps retries at five minutes", () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(autoSyncRetryDelayMs)).toEqual([
      2_000,
      5_000,
      10_000,
      30_000,
      60_000,
      300_000,
      300_000,
    ]);
  });

  it("uses calm user-facing labels", () => {
    expect(autoSyncLabel("saved_locally")).toBe("Saved locally");
    expect(autoSyncLabel("waiting_for_computer")).toBe("Waiting for computer");
    expect(autoSyncLabel("synced")).toBe("Synced");
    expect(autoSyncLabel(null)).toBeNull();
  });

  it("distinguishes saves from lifecycle wakeups", () => {
    expect(saveReasonHasLocalChanges("note saved")).toBe(true);
    expect(saveReasonHasLocalChanges("capture deleted")).toBe(true);
    expect(saveReasonHasLocalChanges("app foregrounded")).toBe(false);
  });
});
