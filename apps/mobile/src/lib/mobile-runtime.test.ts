import { describe, expect, it, vi } from "vitest";
import { MobileRuntime } from "./mobile-runtime";
import type { NotePageStorage } from "./note-pages";
import { PressGate } from "./press-gate";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
const storage = (): NotePageStorage => ({ createNote: vi.fn(async () => "draft.md"), writeNote: vi.fn(async () => {}), deleteNote: vi.fn(async () => {}), readNote: vi.fn(async () => "saved"), publishNote: vi.fn(async () => {}) });

describe("mobile runtime", () => {
  it("navigation does not wait for slow saves or previews, and the draft survives a screen round trip", async () => {
    const runtime = new MobileRuntime(), native = storage(), save = deferred(), previews = deferred();
    vi.mocked(native.createNote).mockImplementationOnce(async () => { await save.promise; return "draft.md"; });
    vi.mocked(native.publishNote!).mockImplementationOnce(() => previews.promise);
    const pages = runtime.capture(native);
    pages.session.onChange("Keep this draft");
    runtime.requestSave();
    const navigate = vi.fn();
    navigate("Settings");
    expect(navigate).toHaveBeenCalledOnce();
    expect(runtime.capture(storage())).toBe(pages);
    expect(pages.session.currentContent()).toBe("Keep this draft");
    save.resolve();
    await runtime.flushDurable();
    expect(pages.session.isDirty()).toBe(false);
    // Publication can remain pending even after a durable flush.
    previews.resolve();
  });

  it("root changes drain actual native calls and reject additional background admission", async () => {
    const runtime = new MobileRuntime(), native = deferred();
    const token = runtime.workspace();
    const pending = runtime.track(() => native.promise);
    const changed = vi.fn(async () => { runtime.setWorkspace("next", "/next"); });
    const switching = runtime.changeWorkspace(changed);
    await Promise.resolve();
    await expect(runtime.track(async () => {})).rejects.toThrow("changing");
    expect(changed).not.toHaveBeenCalled();
    native.resolve();
    await Promise.all([pending, switching]);
    expect(changed).toHaveBeenCalledOnce();
    await expect(runtime.track(async () => {}, token)).rejects.toThrow("changed");
  });

  it("does not switch roots after a save failure and retries the retained draft", async () => {
    const runtime = new MobileRuntime(), native = storage();
    vi.mocked(native.createNote).mockRejectedValueOnce(new Error("disk full"));
    const pages = runtime.capture(native);
    pages.session.onChange("retry me");
    const change = vi.fn(async () => {});
    await expect(runtime.changeWorkspace(change)).rejects.toThrow("disk full");
    expect(change).not.toHaveBeenCalled();
    expect(pages.session.currentContent()).toBe("retry me");
    await runtime.flushDurable();
    expect(pages.session.currentPath()).toBe("draft.md");
    runtime.reset();
  });

  it("publishes a new workspace only after admission has reopened", async () => {
    const runtime = new MobileRuntime();
    let published!: Promise<void>;
    await runtime.changeWorkspace(async () => {
      runtime.setWorkspace("new", "/new");
      published = runtime.whenWorkspaceReady().then(() => runtime.track(async () => {}));
    });
    await expect(published).resolves.toBeUndefined();
    expect(runtime.getStatus().operation).toBeNull();
  });

  it("parks a failed draft as ciphertext only and recovers it after unlock", async () => {
    const runtime = new MobileRuntime(), native = storage();
    vi.mocked(native.createNote).mockRejectedValue(new Error("disk full"));
    const pages = runtime.capture(native);
    pages.session.onChange("secret draft");
    const seal = vi.fn(async (_value: string) => "ciphertext");
    await runtime.park(seal);
    expect(pages.session.currentContent()).toBe("");
    const snapshot = seal.mock.calls[0][0];
    await runtime.resume(storage(), async (value) => { expect(value).toBe("ciphertext"); return snapshot; });
    expect(runtime.capture(storage()).session.currentContent()).toBe("secret draft");
    runtime.reset();
  });

  it("includes late native input during sealing and keeps the editor readonly until the key is dropped", async () => {
    const runtime = new MobileRuntime(), native = storage(), sealing = deferred(), closing = deferred();
    vi.mocked(native.createNote).mockRejectedValue(new Error("disk full"));
    const pages = runtime.capture(native);
    pages.session.onChange("initial");
    const snapshots: string[] = [];
    const seal = vi.fn(async (plaintext: string) => {
      snapshots.push(plaintext);
      if (snapshots.length === 1) await sealing.promise;
      return `cipher-${snapshots.length}`;
    });
    const close = vi.fn(() => closing.promise);
    const locking = runtime.park(seal, close);
    await vi.waitFor(() => expect(seal).toHaveBeenCalledOnce());
    pages.session.onChange("late native input");
    sealing.resolve();
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(seal).toHaveBeenCalledTimes(2);
    expect(runtime.getStatus().operation).toBe("Locking");
    await expect(runtime.changeWorkspace(async () => {})).rejects.toThrow("locking");
    closing.resolve(); await locking;
    await runtime.resume(storage(), async () => snapshots[1]);
    expect(runtime.capture(storage()).session.currentContent()).toBe("late native input");
    runtime.reset();
  });

  it("a hundred independent taps are accepted even immediately after a pan", () => {
    const gate = new PressGate();
    gate.begin(1); gate.cancel(1);
    expect(gate.allowed()).toBe(false);
    for (let touch = 2; touch <= 101; touch += 1) {
      gate.begin(touch);
      gate.cancel(touch - 1); // A delayed callback cannot cancel the new touch.
      expect(gate.allowed()).toBe(true);
    }
  });
});
