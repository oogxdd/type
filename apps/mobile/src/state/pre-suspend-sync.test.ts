import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ flush: vi.fn(async () => {}), sync: vi.fn(), finish: vi.fn(), error: vi.fn() }));
vi.mock("../core/runtime", () => ({ mobileRuntime: { saveError: mocks.error } }));
vi.mock("../lib/capture-draft", () => ({ flushAllDrafts: mocks.flush }));
vi.mock("../lib/background-task", () => ({ finishBackgroundWindow: mocks.finish }));
vi.mock("./sync-store", () => ({ useSyncStore: { getState: () => ({ syncBeforeSuspend: mocks.sync }) } }));
import { runPreSuspendSync } from "./pre-suspend-sync";
import { useBackgroundOperationStore } from "./background-operation-store";

describe("background task lifetime", () => {
  it("releases the OS deadline without admitting duplicate native work or losing its lock hold", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    mocks.sync.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    try {
      runPreSuspendSync();
      await vi.advanceTimersByTimeAsync(25_000);
      expect(mocks.finish).toHaveBeenCalledOnce();
      expect(useBackgroundOperationStore.getState().count).toBe(1);
      runPreSuspendSync();
      expect(mocks.sync).toHaveBeenCalledOnce();
      finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(useBackgroundOperationStore.getState().count).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
