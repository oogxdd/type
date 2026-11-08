import { describe, expect, it, vi } from "vitest";
import { flushAllDrafts, registerEditorDraft } from "./capture-draft";

describe("durable flush boundary", () => {
  it("waits for every editor but reports a failed save instead of successful sync eligibility", async () => {
    const completed = vi.fn();
    const removeFailed = registerEditorDraft(async () => { throw new Error("disk full"); });
    const removeSuccessful = registerEditorDraft(async () => { await Promise.resolve(); completed(); });
    try {
      await expect(flushAllDrafts()).rejects.toThrow("disk full");
      expect(completed).toHaveBeenCalledOnce();
    } finally { removeFailed(); removeSuccessful(); }
    await expect(flushAllDrafts()).resolves.toBeUndefined();
  });
});
