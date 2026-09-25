import { describe, expect, it } from "vitest";

import {
  ACTION_SYNC_DELAY_MS,
  EDIT_SYNC_DEBOUNCE_MS,
  EDIT_SYNC_MAX_WAIT_MS,
  nextPendingSync,
  type PendingSync,
} from "./sync-schedule";

const typeAt = (times: number[]): PendingSync => {
  let pending: PendingSync | null = null;
  for (const time of times) {
    pending = nextPendingSync(pending, "edit", time);
  }
  return pending!;
};

describe("sync schedule", () => {
  it("waits for a pause after the last keystroke", () => {
    expect(typeAt([0, 5_000, 20_000]).dueAt).toBe(20_000 + EDIT_SYNC_DEBOUNCE_MS);
  });

  it("still syncs during a long typing session", () => {
    const everyTenSeconds = Array.from({ length: 60 }, (_, i) => i * 10_000);
    expect(typeAt(everyTenSeconds).dueAt).toBe(EDIT_SYNC_MAX_WAIT_MS);
  });

  it("syncs finished actions promptly, even mid-edit batch", () => {
    const pending = nextPendingSync(typeAt([0, 1_000]), "action", 2_000);
    expect(pending.dueAt).toBe(2_000 + ACTION_SYNC_DELAY_MS);
    expect(pending.urgent).toBe(true);
  });

  it("never lets typing postpone a filed page", () => {
    const filed = nextPendingSync(null, "action", 0);
    const typing = nextPendingSync(filed, "edit", 1_000);
    expect(typing.dueAt).toBe(ACTION_SYNC_DELAY_MS);
  });

  it("keeps the earliest of several actions", () => {
    const first = nextPendingSync(null, "action", 0);
    expect(nextPendingSync(first, "action", 1_000).dueAt).toBe(ACTION_SYNC_DELAY_MS);
    expect(nextPendingSync(first, "now", 1_000).dueAt).toBe(1_000);
  });

  it("an action replaces a later edit deadline", () => {
    expect(nextPendingSync(typeAt([0]), "action", 100).dueAt).toBe(100 + ACTION_SYNC_DELAY_MS);
  });
});
