// Filing a page from the capture screen must not re-read the whole notes
// folder. `list_note_previews` returns each note's decrypted *body*, so asking
// for every path ships the entire corpus over the FFI bridge as one JSON
// string and parses it again in JS — a cost that grows with the folder and is
// paid on every swipe-up. These tests pin the cheap path.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockCore } from "@typenotes/mobile-core/mock-core";
import { setRawCore, type RawCore } from "@typenotes/mobile-core/raw-core";
import type { ProfilesSnapshot } from "@typenotes/shared/types";

import { useNotesStore } from "./notes-store";
import { useSecurityStore } from "./security-store";
import { useSettingsStore } from "./settings-store";
import { findFolder, folderNoteCount } from "../lib/feed";

/** The preview snapshots on "disk", by working folder id. */
const snapshotFiles = vi.hoisted(() => new Map<string, string>());

vi.mock("./preview-snapshot-file", () => ({
  readPreviewSnapshot: async (profileId: string) => snapshotFiles.get(profileId) ?? null,
  writePreviewSnapshot: async (profileId: string, contents: string) => {
    snapshotFiles.set(profileId, contents);
  },
  deletePreviewSnapshot: async (profileId: string) => {
    snapshotFiles.delete(profileId);
  },
}));

const useWorkingFolder = (id: string) =>
  useSettingsStore.setState({
    snapshot: {
      active_profile_id: id,
      profiles: [{ id, name: id, notes_root: `/notes/${id}` }],
    } as unknown as ProfilesSnapshot,
  });

const useEncryption = (enabled: boolean) =>
  useSecurityStore.setState({
    state: { encryption_enabled: enabled, locked: false, auto_lock_on_background: false },
  });

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
    useNotesStore.setState(useNotesStore.getInitialState());
    useSettingsStore.setState({ snapshot: null });
    useSecurityStore.setState({ state: null });
    snapshotFiles.clear();
  });

  it("reads every note's body on the first refresh", async () => {
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

  it("keeps a note filed while a full refresh is still reading", async () => {
    // Launch no longer waits for the full refresh, so with a large folder the
    // user can file a page while it runs. Its end must not write back the
    // tree it started from.
    for (let index = 0; index < 250; index += 1) {
      await createNote(core, `note ${index}`);
    }
    let filed: string | null = null;
    setRawCore({
      ...core,
      listNotePreviews: async (paths: string[]) => {
        if (filed === null) {
          filed = await createNote(core, "filed mid-refresh");
          await useNotesStore.getState().noteFiled(filed);
        }
        return core.listNotePreviews(paths);
      },
    });

    await useNotesStore.getState().refresh();

    const { tree, previews } = useNotesStore.getState();
    expect(findFolder(tree, "_system/stream")!.notes.map((n) => n.path)).toContain(filed);
    expect(previews.get(filed!)?.title).toBe("filed mid-refresh");
    expect(previews.size).toBe(251);
  });

  it("coalesces refreshes that overlap", async () => {
    await createNote(core, "only");
    let treeReads = 0;
    setRawCore({
      ...core,
      getTree: () => {
        treeReads += 1;
        return core.getTree();
      },
    });
    await useNotesStore.getState().refresh();
    const perRun = treeReads;
    treeReads = 0;

    await Promise.all([
      useNotesStore.getState().refresh(),
      useNotesStore.getState().refresh(),
      useNotesStore.getState().refresh(),
    ]);

    // The first run plus one rerun for everything that asked meanwhile.
    expect(treeReads).toBe(2 * perRun);
    expect(useNotesStore.getState().loading).toBe(false);
  });

  it("keeps an edit re-read during a refresh over the refresh's older copy", async () => {
    const target = await createNote(core, "before the edit");
    let edited = false;
    setRawCore({
      ...core,
      listNotePreviews: async (paths: string[]) => {
        const result = await core.listNotePreviews(paths);
        if (!edited) {
          // The refresh has read the old body; now the note changes and the
          // editor re-reads it before the refresh gets to publish.
          edited = true;
          await core.writeNote(target, "after the edit");
          await useNotesStore.getState().refreshPreviews([target]);
        }
        return result;
      },
    });

    await useNotesStore.getState().refresh();

    expect(useNotesStore.getState().previews.get(target)?.title).toBe("after the edit");
  });

  it("keeps previews a refresh published while a re-read was in flight", async () => {
    // A re-read used to copy the cache before awaiting the core and write the
    // copy back afterwards, wiping everything a background refresh had
    // published in between.
    for (let index = 0; index < 5; index += 1) {
      await createNote(core, `note ${index}`);
    }
    const target = await createNote(core, "re-read");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    setRawCore({
      ...core,
      listNotePreviews: async (paths: string[]) => {
        const result = await core.listNotePreviews(paths);
        if (paths.length === 1) {
          await held;
        }
        return result;
      },
    });

    const reread = useNotesStore.getState().refreshPreviews([target]);
    await useNotesStore.getState().refresh();
    release();
    await reread;

    expect(useNotesStore.getState().previews.size).toBe(6);
  });

  it("publishes the top of the Feed first, then the rest, in three steps", async () => {
    // Every publish rebuilds the menu lists, which sort and date-group the
    // whole Feed; publishing per batch made that happen dozens of times.
    for (let index = 0; index < 450; index += 1) {
      await createNote(core, `feed ${index}`);
    }
    const toMove = [await createNote(core, "work a"), await createNote(core, "work b")];
    await core.moveItems(toMove, "Work");
    const published: Map<string, unknown>[] = [];
    const unsubscribe = useNotesStore.subscribe((state, previous) => {
      if (state.previews !== previous.previews) {
        published.push(state.previews);
      }
    });

    await useNotesStore.getState().refresh();
    unsubscribe();

    expect(published).toHaveLength(3);
    const [top, feed, everything] = published;
    const feedInTreeOrder = findFolder(useNotesStore.getState().tree, "_system/stream")!.notes.map(
      (note) => note.path
    );
    expect([...top.keys()]).toEqual(feedInTreeOrder.slice(0, 200));
    expect(feed.size).toBe(450);
    expect(everything.size).toBe(452);
  });

  it("reads only the notes whose file changed on a later refresh", async () => {
    const kept = await createNote(core, "kept");
    const edited = await createNote(core, "edited");
    await useNotesStore.getState().refresh();
    await core.writeNote(edited, "edited again");
    previewCalls.length = 0;

    await useNotesStore.getState().refresh();

    expect(previewCalls).toEqual([[edited]]);
    const { previews } = useNotesStore.getState();
    expect(previews.get(edited)?.title).toBe("edited again");
    expect(previews.get(kept)?.title).toBe("kept");
  });

  it("restores a working folder's previews from its snapshot, reading only what changed", async () => {
    useEncryption(false);
    useWorkingFolder("journal");
    const kept = await createNote(core, "kept");
    const edited = await createNote(core, "edited");
    await useNotesStore.getState().refresh();
    expect(snapshotFiles.has("journal")).toBe(true);

    // Another working folder drops everything held for this one...
    useWorkingFolder("work");
    await useNotesStore.getState().refresh();
    // ...so coming back is a relaunch in miniature: the snapshot fills the
    // lists, and only the note that changed meanwhile is read.
    await core.writeNote(edited, "edited while away");
    useWorkingFolder("journal");
    previewCalls.length = 0;

    await useNotesStore.getState().refresh();

    expect(previewCalls).toEqual([[edited]]);
    const { previews } = useNotesStore.getState();
    expect(previews.get(kept)?.title).toBe("kept");
    expect(previews.get(edited)?.title).toBe("edited while away");
  });

  it("never keeps previews on disk while encryption is on", async () => {
    // Left over from before encryption was turned on.
    snapshotFiles.set("journal", "{}");
    useEncryption(true);
    useWorkingFolder("journal");
    await createNote(core, "secret");

    await useNotesStore.getState().refresh();

    expect(snapshotFiles.has("journal")).toBe(false);
    expect(useNotesStore.getState().previews.size).toBe(1);
  });
});

