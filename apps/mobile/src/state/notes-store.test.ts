// Filing a page from the capture screen must not re-read the whole notes
// folder. `list_note_previews` returns each note's decrypted *body*, so asking
// for every path ships the entire corpus over the FFI bridge as one JSON
// string and parses it again in JS — a cost that grows with the folder and is
// paid on every swipe-up. These tests pin the cheap path.

import { beforeEach, describe, expect, it } from "vitest";

import { createMockCore } from "@typenotes/mobile-core/mock-core";
import { setRawCore, type RawCore } from "@typenotes/mobile-core/raw-core";

import { useNotesStore } from "./notes-store";
import { findFolder, folderNoteCount } from "../lib/feed";

/** Wraps the in-memory core so the test can see which paths were asked for. */
const trackPreviewCalls = (core: RawCore) => {
  const calls: string[][] = [];
  setRawCore({
    ...core,
    listNotePreviews: (paths: string[]) => {
      calls.push([...paths]);
      return core.listNotePreviews(paths);
    },
  });
  return calls;
};

const createNote = async (core: RawCore, content: string): Promise<string> => {
  const created = JSON.parse(await core.createNote(JSON.stringify({ content })));
  return created.path as string;
};

describe("notes store", () => {
  let core: RawCore;
  let previewCalls: string[][];

  beforeEach(async () => {
    core = createMockCore();
    await core.initCore("/tmp/type-test", "/tmp");
    previewCalls = trackPreviewCalls(core);
    useNotesStore.setState({ tree: null, previews: new Map(), error: null });
  });

  it("reads every note's body on a full refresh", async () => {
    await createNote(core, "first");
    await createNote(core, "second");
    previewCalls.length = 0;

    await useNotesStore.getState().refresh();

    expect(previewCalls).toHaveLength(1);
    expect(previewCalls[0].length).toBe(2);
    expect(useNotesStore.getState().previews.size).toBe(2);
  });

  it("asks for only the filed note's preview when a page is filed", async () => {
    await createNote(core, "an older note");
    const filed = await createNote(core, "the page just filed");
    previewCalls.length = 0;

    await useNotesStore.getState().noteFiled(filed);

    expect(previewCalls).toEqual([[filed]]);
  });

  it("still puts the filed note in the tree and the preview cache", async () => {
    const filed = await createNote(core, "the page just filed");

    await useNotesStore.getState().noteFiled(filed);

    const { tree, previews } = useNotesStore.getState();
    expect(tree).not.toBeNull();
    expect(previews.get(filed)?.title).toBe("the page just filed");
  });

  it("asks for previews in bounded batches", async () => {
    // One giant list_note_previews call builds the whole decrypted corpus as a
    // single JSON string on both sides of the FFI bridge.
    for (let index = 0; index < 250; index += 1) {
      await createNote(core, `note ${index}`);
    }
    previewCalls.length = 0;

    await useNotesStore.getState().refresh();

    expect(previewCalls.length).toBeGreaterThan(1);
    for (const call of previewCalls) {
      expect(call.length).toBeLessThanOrEqual(200);
    }
    const asked = previewCalls.flat();
    expect(new Set(asked).size).toBe(250);
    expect(useNotesStore.getState().previews.size).toBe(250);
  });

  it("moves notes into a folder it creates on the way", async () => {
    // There is no create-folder command anywhere in the core: a new folder
    // comes into existence because something was moved into its path.
    const first = await createNote(core, "first");
    const second = await createNote(core, "second");
    await useNotesStore.getState().refresh();
    previewCalls.length = 0;

    await useNotesStore.getState().moveNotes([first, second], "Work/Q3");

    const { tree, previews } = useNotesStore.getState();
    expect(folderNoteCount(findFolder(tree, "Work/Q3"))).toBe(2);
    expect(previews.has(first)).toBe(false);
    const moved = findFolder(tree, "Work/Q3")!.notes.map((note) => note.path);
    for (const path of moved) {
      expect(previews.get(path)).toBeDefined();
    }
    // Only the two notes whose path changed were re-read.
    expect(previewCalls.flat().sort()).toEqual([...moved].sort());
  });

  it("drops previews for deleted notes without re-reading the rest", async () => {
    const keep = await createNote(core, "keep me");
    const drop = await createNote(core, "drop me");
    await useNotesStore.getState().refresh();
    previewCalls.length = 0;

    await useNotesStore.getState().deleteNotes([drop]);

    const { previews } = useNotesStore.getState();
    expect(previews.has(drop)).toBe(false);
    expect(previews.get(keep)?.title).toBe("keep me");
    expect(previewCalls).toEqual([]);
  });

  it("archives a note in place and re-reads only that note", async () => {
    const other = await createNote(core, "untouched");
    const target = await createNote(core, "to archive");
    await useNotesStore.getState().refresh();
    previewCalls.length = 0;

    await useNotesStore.getState().setArchived(target, true);

    expect(previewCalls).toEqual([[target]]);
    expect(useNotesStore.getState().previews.get(target)?.isArchived).toBe(true);
    expect(useNotesStore.getState().previews.get(other)?.isArchived).toBe(false);
  });

  it("keeps previews already in the cache", async () => {
    const older = await createNote(core, "an older note");
    await useNotesStore.getState().refresh();
    const filed = await createNote(core, "the page just filed");

    await useNotesStore.getState().noteFiled(filed);

    expect(useNotesStore.getState().previews.get(older)?.title).toBe(
      "an older note"
    );
  });
});
