import { describe, expect, it, vi } from "vitest";
import { NotePages, type NotePageStorage } from "./note-pages";
import { createMockCore } from "@typenotes/mobile-core/mock-core";
import { setRawCore } from "@typenotes/mobile-core/raw-core";
import { readNoteIfExists } from "@typenotes/mobile-core/core-api";

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
  it("opens 100 pages directly in a 10,000-note store without requesting a tree", async () => {
    const core = createMockCore();
    await core.initCore("/tmp/type-pages-synthetic", "/tmp");
    const paths: string[] = [];
    for (let index = 0; index < 10_000; index += 1) paths.push(JSON.parse(await core.createNote(JSON.stringify({ content: `note ${index}` }))).path);
    const getTree = vi.fn(core.getTree);
    setRawCore({ ...core, getTree });
    const pages = new NotePages({ readNote: readNoteIfExists, createNote: async () => { throw new Error("unexpected create"); }, writeNote: core.writeNote, deleteNote: async (path) => core.deleteItems([path]) });
    for (let index = 0; index < 100; index += 1) await pages.open(paths[index], paths);
    expect(getTree).not.toHaveBeenCalled();
    expect(pages.session.currentContent()).toBe("note 99");
    await expect(pages.open("missing.md", paths)).rejects.toThrow("no longer exists");
    expect(pages.session.currentContent()).toBe("note 99");
    setRawCore({ ...core, readNoteIfExists: async () => undefined });
    expect(await readNoteIfExists("native-missing.md")).toBeNull();
  });

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
