import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentSession } from "./document-session";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());
describe("document session", () => {
  it("debounces independently and flushes every note exactly once", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async (_path: string, _text: string) => {});
    const session = new DocumentSession({ read: async () => "original", write });
    session.select(["A", "B"]);
    await session.load("A");
    session.change("A", "edited A"); session.change("B", "edited B");
    await vi.advanceTimersByTimeAsync(399);
    expect(write).not.toHaveBeenCalled();
    await session.flushAll();
    expect(write.mock.calls).toEqual([["A", "edited A"], ["B", "edited B"]]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(2);
    session.dispose();
  });
  it("serializes overlapping writes and waits for the newest draft", async () => {
    const first = deferred<void>();
    const write = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined);
    const session = new DocumentSession({ read: async () => "", write });
    session.change("A", "first"); const flushing = session.flushAll();
    session.change("A", "latest"); const secondFlush = session.flushAll();
    expect(write).toHaveBeenCalledTimes(1);
    first.resolve(); await Promise.all([flushing, secondFlush]);
    expect(write.mock.calls).toEqual([["A", "first"], ["A", "latest"]]);
    expect(session.documents.get("A")?.dirty).toBe(false);
    session.dispose();
  });
  it("retains failed drafts after navigation and retries their original path", async () => {
    const write = vi.fn().mockRejectedValue(new Error("disk unavailable"));
    const session = new DocumentSession({ read: async () => "original", write });
    session.select(["A"]); await session.load("A");
    session.change("A", "must survive"); session.select(["B"]);
    await expect(session.flushAll()).rejects.toThrow("disk unavailable");
    expect(session.documents.get("A")).toMatchObject({ dirty: true, content: "must survive", error: "disk unavailable" });
    write.mockResolvedValue(undefined);
    await session.flushAll();
    expect(write.mock.calls.every(([path, content]) => path === "A" && content === "must survive")).toBe(true);
    expect(session.documents.get("A")?.dirty).toBe(false);
    session.dispose();
  });
  it("ignores own preview invalidations but accepts clean external refreshes", async () => {
    const read = vi.fn(async () => "disk");
    const session = new DocumentSession({ read, write: async () => {}, saved: (path) => session.refresh(path) });
    session.select(["A"]); await session.load("A");
    session.change("A", "draft"); await session.flushAll();
    expect(read).toHaveBeenCalledTimes(1);
    expect(session.documents.get("A")?.content).toBe("draft");
    await session.load("A", true);
    expect(session.documents.get("A")?.content).toBe("disk");
    session.dispose();
  });
  it("rejects a late read even after the newer edit finishes saving", async () => {
    const pending = deferred<string>();
    const session = new DocumentSession({ read: () => pending.promise, write: async () => {} });
    const loading = session.load("A"); session.change("A", "new text");
    await session.flushAll(); pending.resolve("old text"); await loading;
    expect(session.documents.get("A")?.content).toBe("new text");
    session.dispose();
  });
  it("retains existing entries when selection grows and finalizes only departures", async () => {
    const leave = vi.fn(async (_path: string, _content: string, _edited: boolean) => {});
    const session = new DocumentSession({ read: async () => "original", write: async () => {}, leave });
    session.select(["A"]); await session.load("A");
    const entry = session.documents.get("A");
    session.select(["A", "B"]); await session.load("B");
    expect(session.documents.get("A")).toBe(entry);
    expect(leave).not.toHaveBeenCalled();
    session.select(["B"]); await session.flushAll();
    expect(leave.mock.calls).toEqual([["A", "original", false]]);
    expect(session.documents.has("A")).toBe(false);
    session.dispose();
  });
  it("does not finalize a note reselected during its save", async () => {
    const pending = deferred<void>();
    const leave = vi.fn(async (_path: string, _content: string, _edited: boolean) => {});
    const session = new DocumentSession({ read: async () => "original", write: () => pending.promise, leave });
    session.select(["A"]); await session.load("A");
    session.change("A", "draft"); session.select(["B"]); session.select(["A"]);
    pending.resolve(); await session.flushAll();
    expect(leave.mock.calls.some(([path]) => path === "A")).toBe(false);
    expect(session.documents.get("A")?.content).toBe("draft");
    session.dispose();
  });
  it("never renames a deleted file when leaving the selection", async () => {
    const read = vi.fn().mockResolvedValueOnce("original").mockRejectedValue(new Error("missing"));
    const leave = vi.fn(async () => {});
    const session = new DocumentSession({ read, write: async () => {}, leave });
    session.select(["A"]); await session.load("A");
    session.select([]); await session.flushAll();
    expect(leave).not.toHaveBeenCalled();
    expect(session.documents.has("A")).toBe(false);
    session.dispose();
  });
  it("cancels timers belonging to a disposed profile", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => {});
    const session = new DocumentSession({ read: async () => "", write });
    session.change("same/path.md", "old profile"); session.dispose();
    await vi.advanceTimersByTimeAsync(1000); await session.flushAll();
    expect(write).not.toHaveBeenCalled();
  });
  it("retains load errors for retry without exposing an empty writable document", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("recovered");
    const session = new DocumentSession({ read, write: async () => {} });
    await session.load("A");
    expect(session.documents.get("A")).toMatchObject({ loaded: false, error: "offline" });
    await session.load("A", true);
    expect(session.documents.get("A")).toMatchObject({ loaded: true, error: null, content: "recovered" });
    session.dispose();
  });
});
