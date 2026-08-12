// Filing a page from the capture screen must not re-read the whole notes
// folder. `list_note_previews` returns each note's decrypted *body*, so asking
// for every path ships the entire corpus over the FFI bridge as one JSON
// string and parses it again in JS — a cost that grows with the folder and is
// paid on every swipe-up. These tests pin the cheap path.

import { beforeEach, describe, expect, it } from "vitest";

import { createMockCore } from "@typenotes/mobile-core/mock-core";
import { setRawCore, type RawCore } from "@typenotes/mobile-core/raw-core";

import { useNotesStore } from "./notes-store";

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
