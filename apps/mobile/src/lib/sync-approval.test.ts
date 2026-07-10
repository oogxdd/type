import { describe, expect, it, vi } from "vitest";

import {
  classifyDesktopApprovalError,
  runWithDesktopApproval,
} from "./sync-approval";

describe("desktop sync approval", () => {
  it("classifies stable server markers", () => {
    expect(
      classifyDesktopApprovalError(
        new Error("remote: TYPE_SYNC_APPROVAL_REQUIRED: Waiting for approval")
      )
    ).toBe("required");
    expect(
      classifyDesktopApprovalError(new Error("TYPE_SYNC_APPROVAL_DECLINED: no"))
    ).toBe("declined");
    expect(classifyDesktopApprovalError(new Error("connection refused"))).toBeNull();
  });

  it("waits and retries until the desktop opens the window", async () => {
    const waiting = vi.fn();
    const sleep = vi.fn(async () => {});
    let attempts = 0;
    const result = await runWithDesktopApproval(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("TYPE_SYNC_APPROVAL_REQUIRED");
        }
        return "synced";
      },
      { onWaiting: waiting, sleep }
    );

    expect(result).toBe("synced");
    expect(attempts).toBe(2);
    expect(waiting).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(1500);
  });

  it("stops retrying when the desktop declines", async () => {
    await expect(
      runWithDesktopApproval(
        async () => {
          throw new Error("TYPE_SYNC_APPROVAL_DECLINED");
        },
        { onWaiting: () => {}, sleep: async () => {} }
      )
    ).rejects.toThrow("declined on the desktop");
  });
});
