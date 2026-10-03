import { describe, expect, it, vi } from "vitest";
import { NotePages, type NotePageStorage } from "./note-pages";

const fixture = () => {
  const notes = new Map([["a.md", "Alpha"], ["b.md", "Beta"], ["c.md", "Gamma"]]);
  const storage: NotePageStorage = {
    readNote: vi.fn(async (path) => notes.get(path) ?? null),
    createNote: vi.fn(async (content) => { notes.set("draft.md", content); return "draft.md"; }),
    writeNote: vi.fn(async (path, content) => { notes.set(path, content); }),
    deleteNote: vi.fn(async (path) => { notes.delete(path); }),
  };
  return { pages: new NotePages(storage), notes, storage };
};

describe("the shared capture and saved-note page", () => {
  it("follows the supplied filtered order in both directions, stopping at its edges", async () => {
    const { pages, storage } = fixture();
    await pages.open("c.md", ["c.md", "a.md"]);
    expect(pages.previousPath).toBeNull();
    expect(pages.nextPath).toBe("a.md");
    await pages.advance(-1);
    expect(pages.session.currentPath()).toBe("c.md");
    await pages.advance();
    expect(pages.session.currentContent()).toBe("Alpha");
    expect(pages.nextPath).toBeNull();
    await pages.advance();
    expect(pages.session.currentPath()).toBe("a.md");
    await pages.advance(-1);
    expect(pages.session.currentPath()).toBe("c.md");
    expect(storage.createNote).not.toHaveBeenCalled();
    expect(storage.deleteNote).not.toHaveBeenCalled();
  });

  it("saves edits before paging and retains the capture draft on a menu round trip", async () => {
    const { pages, notes } = fixture();
    pages.session.onChange("Unfinished capture");
    await pages.open("a.md", ["a.md", "b.md"]);
    expect(notes.get("draft.md")).toBe("Unfinished capture");
    pages.session.onChange("Edited alpha");
    await pages.advance();
    expect(notes.get("a.md")).toBe("Edited alpha");
    await pages.returnToCapture();
    expect(pages.browsing).toBe(false);
    expect(pages.session.currentContent()).toBe("Unfinished capture");
  });

  it("returns to a blank capture when there was no draft", async () => {
    const { pages } = fixture();
    await pages.open("a.md", ["a.md"]);
    await pages.returnToCapture();
    expect(pages.browsing).toBe(false);
    expect(pages.session.currentPath()).toBeNull();
    expect(pages.session.currentContent()).toBe("");
  });

  it("does not overwrite edits made while browsing the draft itself", async () => {
    const { pages } = fixture();
    pages.session.onChange("Draft");
    await pages.session.flush();
    await pages.open("draft.md", ["draft.md"]);
    pages.session.onChange("Edited through the list");
    await pages.returnToCapture();
    expect(pages.session.currentContent()).toBe("Edited through the list");
  });

  it("retains failed writes for retry and does not advance the page", async () => {
    const { pages, notes, storage } = fixture();
    await pages.open("a.md", ["a.md", "b.md"]);
    pages.session.onChange("Keep this edit");
    vi.mocked(storage.writeNote).mockRejectedValueOnce(new Error("Disk full"));
    await expect(pages.advance()).rejects.toThrow("Disk full");
    expect(pages.session.currentPath()).toBe("a.md");
    expect(pages.session.currentContent()).toBe("Keep this edit");
    await pages.advance();
    expect(notes.get("a.md")).toBe("Keep this edit");
    expect(pages.session.currentPath()).toBe("b.md");
  });

  it("keeps the current page when the next note cannot be read", async () => {
    const { pages, storage } = fixture();
    await pages.open("a.md", ["a.md", "b.md"]);
    vi.mocked(storage.readNote).mockRejectedValueOnce(new Error("Locked"));
    await expect(pages.advance()).rejects.toThrow("Locked");
    expect(pages.session.currentContent()).toBe("Alpha");
  });

  it("does not delete an emptied saved note when paging", async () => {
    const { pages, notes, storage } = fixture();
    await pages.open("a.md", ["a.md", "b.md"]);
    pages.session.onChange("");
    await pages.advance();
    expect(notes.get("a.md")).toBe("");
    expect(storage.deleteNote).not.toHaveBeenCalled();
  });

  it("does not resurrect a draft deleted from the menu", async () => {
    const { pages, notes } = fixture();
    pages.session.onChange("Draft");
    await pages.open("a.md", ["a.md"]);
    notes.delete("draft.md");
    await pages.returnToCapture();
    expect(pages.session.currentPath()).toBeNull();
    expect(pages.session.currentContent()).toBe("");
  });

  it("ignores backward paging on capture", async () => {
    const { pages, storage } = fixture();
    await pages.advance(-1);
    expect(pages.browsing).toBe(false);
    expect(storage.createNote).not.toHaveBeenCalled();
  });
});
