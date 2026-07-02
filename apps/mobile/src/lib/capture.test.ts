import { describe, expect, it, vi } from "vitest";

import { CaptureSession, type CaptureStorage } from "./capture";

const makeStorage = () => {
  const notes = new Map<string, string>();
  let counter = 0;
  const storage: CaptureStorage = {
    createNote: vi.fn(async (content: string) => {
      counter += 1;
      const path = `Feed/note-${counter}.md`;
      notes.set(path, content);
      return path;
    }),
    writeNote: vi.fn(async (path: string, content: string) => {
      notes.set(path, content);
    }),
    deleteNote: vi.fn(async (path: string) => {
      notes.delete(path);
    }),
  };
  return { storage, notes };
};

describe("CaptureSession", () => {
  it("creates the note once on first flush, then writes", async () => {
    const { storage, notes } = makeStorage();
    const session = new CaptureSession(storage, 10_000);

    session.onChange("h");
    session.onChange("hello");
    await session.flush();
    expect(storage.createNote).toHaveBeenCalledTimes(1);
    expect(notes.get("Feed/note-1.md")).toBe("hello");

    session.onChange("hello world");
    await session.flush();
    expect(storage.createNote).toHaveBeenCalledTimes(1);
    expect(storage.writeNote).toHaveBeenCalledWith("Feed/note-1.md", "hello world");
  });

  it("does not create anything for whitespace-only content", async () => {
    const { storage } = makeStorage();
    const session = new CaptureSession(storage, 10_000);
    session.onChange("   \n");
    await session.flush();
    expect(storage.createNote).not.toHaveBeenCalled();
    expect(await session.commit()).toBeNull();
  });

  it("commit returns the path and resets for a fresh page", async () => {
    const { storage } = makeStorage();
    const session = new CaptureSession(storage, 10_000);
    session.onChange("first note");
    expect(await session.commit()).toBe("Feed/note-1.md");
    expect(session.currentPath()).toBeNull();

    session.onChange("second note");
    expect(await session.commit()).toBe("Feed/note-2.md");
    expect(storage.createNote).toHaveBeenCalledTimes(2);
  });

  it("deletes the note when committed empty (empty-note cleanup)", async () => {
    const { storage, notes } = makeStorage();
    const session = new CaptureSession(storage, 10_000);
    session.onChange("typo");
    await session.flush();
    session.onChange("");
    expect(await session.commit()).toBeNull();
    expect(storage.deleteNote).toHaveBeenCalledWith("Feed/note-1.md");
    expect(notes.size).toBe(0);
  });

  it("serializes a slow create against following writes", async () => {
    const notes = new Map<string, string>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const storage: CaptureStorage = {
      createNote: async (content) => {
        await gate;
        notes.set("Feed/slow.md", content);
        return "Feed/slow.md";
      },
      writeNote: async (path, content) => {
        notes.set(path, content);
      },
      deleteNote: async () => {},
    };
    const session = new CaptureSession(storage, 10_000);
    session.onChange("a");
    const first = session.flush();
    session.onChange("ab");
    const second = session.flush();
    release();
    await Promise.all([first, second]);
    expect(notes.get("Feed/slow.md")).toBe("ab");
  });

  it("debounces writes on its own timer", async () => {
    vi.useFakeTimers();
    try {
      const { storage } = makeStorage();
      const session = new CaptureSession(storage, 500);
      session.onChange("h");
      session.onChange("hi");
      expect(storage.createNote).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(499);
      expect(storage.createNote).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(storage.createNote).toHaveBeenCalledTimes(1);
      expect(storage.createNote).toHaveBeenCalledWith("hi");
    } finally {
      vi.useRealTimers();
    }
  });
});
