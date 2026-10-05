// Pin bounded compact reads, no-op refreshes and isolation of async results.

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
    return true;
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
    listNoteSummaries: (paths: string[]) => {
      calls.push([...paths]);
      return core.listNoteSummaries(paths);
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

  it("loads every note's compact summary on the first refresh", async () => {
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
    // The native endpoint also caps its batches at 200.
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
      listNoteSummaries: async (paths: string[]) => {
        if (filed === null) {
          filed = await createNote(core, "filed mid-refresh");
          await useNotesStore.getState().noteFiled(filed);
        }
        return core.listNoteSummaries(paths);
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
      listNoteSummaries: async (paths: string[]) => {
        const result = await core.listNoteSummaries(paths);
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
      listNoteSummaries: async (paths: string[]) => {
        const result = await core.listNoteSummaries(paths);
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

  it("publishes the Feed in bounded portions before ordinary folders", async () => {
    // Each bounded publication lets recent rows appear before the rest.
    for (let index = 0; index < 450; index += 1) {
      await createNote(core, `feed ${index}`);
    }
    const toMove = [await createNote(core, "work a"), await createNote(core, "work b")];
    await core.moveItems(toMove, "Work");
    const published: Map<string, unknown>[] = [];
    const unsubscribe = useNotesStore.subscribe((state, previous) => {
      if (state.folderRevisions !== previous.folderRevisions && state.previews.size > 0) {
        published.push(new Map(state.previews));
      }
    });

    await useNotesStore.getState().refresh();
    unsubscribe();

    expect(published).toHaveLength(4);
    const [top, , feed, everything] = published;
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

  it("keeps tree, preview and folder references on an unchanged refresh", async () => {
    useEncryption(false);
    useWorkingFolder("journal");
    await createNote(core, "unchanged");
    await useNotesStore.getState().refresh();
    const before = useNotesStore.getState();
    const snapshot = snapshotFiles.get("journal");
    previewCalls.length = 0;

    await useNotesStore.getState().refresh();

    expect(previewCalls).toEqual([]);
    expect(useNotesStore.getState().tree).toBe(before.tree);
    expect(useNotesStore.getState().previews).toBe(before.previews);
    expect(useNotesStore.getState().folderPreviews).toBe(before.folderPreviews);
    expect(snapshotFiles.get("journal")).toBe(snapshot);
  });

  it("does not scan the tree when publishing an edited known note", async () => {
    const path = await createNote(core, "before");
    await useNotesStore.getState().refresh();
    const getTree = vi.fn(core.getTree);
    setRawCore({ ...core, getTree });
    await core.writeNote(path, "after");

    await useNotesStore.getState().noteFiled(path);

    expect(getTree).not.toHaveBeenCalled();
    expect(useNotesStore.getState().previews.get(path)?.title).toBe("after");
  });

  it("reports a failed publication so a saved revision can be retried", async () => {
    const path = await createNote(core, "before");
    await useNotesStore.getState().refresh();
    setRawCore({ ...core, listNoteSummaries: async () => { throw Error("read failed"); } });
    await expect(useNotesStore.getState().noteFiled(path)).rejects.toThrow("read failed");
    setRawCore(core);
    await core.writeNote(path, "after");
    await useNotesStore.getState().noteFiled(path);
    expect(useNotesStore.getState().previews.get(path)?.title).toBe("after");
  });

  it("discards previews from a profile changed while native reading was in flight", async () => {
    useWorkingFolder("first");
    const path = await createNote(core, "old profile");
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const reading = new Promise<void>((resolve) => { started = resolve; });
    setRawCore({ ...core, listNoteSummaries: async (paths) => {
      const raw = await core.listNoteSummaries(paths);
      started();
      await held;
      return raw;
    } });
    const refresh = useNotesStore.getState().refresh();
    await reading;
    useWorkingFolder("second");
    release();
    await refresh;
    expect(useNotesStore.getState().previews.has(path)).toBe(false);
    expect(useNotesStore.getState().tree).toBeNull();
    expect(useNotesStore.getState().loading).toBe(false);
  });

  it("clears plaintext in both runtimes when locked during native reading", async () => {
    useWorkingFolder("journal");
    useEncryption(true);
    const path = await createNote(core, "secret");
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const reading = new Promise<void>((resolve) => { started = resolve; });
    setRawCore({ ...core, listNoteSummaries: async (paths) => {
      const raw = await core.listNoteSummaries(paths);
      started();
      await held;
      return raw;
    } });
    const refresh = useNotesStore.getState().refresh();
    await reading;
    useSecurityStore.setState({ state: { encryption_enabled: true, locked: true, auto_lock_on_background: false } });
    release();
    await refresh;
    expect(useNotesStore.getState().previews.has(path)).toBe(false);
    expect(useNotesStore.getState().tree).toBeNull();
    const { runNoteJob } = await import("../lib/note-worker");
    const cached = await runNoteJob({ kind: "snapshot", scope: useNotesStore.getState().processingScope });
    expect(cached.raw).not.toContain("secret");
    expect(snapshotFiles.has("journal")).toBe(false);
  });

  it("publishes today and this week before history and opens an old note independently", async () => {
    const date = (days: number) => {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, 12).getTime();
    };
    const monday = (new Date().getDay() + 6) % 7;
    const datedNote = async (days: number, text: string) => {
      const entry = JSON.parse(await core.createNote(JSON.stringify({ content: text, timestamp_ms: date(days) })));
      return entry.path as string;
    };
    const old = await datedNote(30, "history");
    const week = monday ? await datedNote(monday, "this week") : null;
    const today = await datedNote(0, "today");
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const history = new Promise<void>((resolve) => { started = resolve; });
    const calls: string[][] = [];
    setRawCore({ ...core, listNoteSummaries: async (paths) => {
      calls.push(paths);
      if (paths.includes(old)) { started(); await held; }
      return core.listNoteSummaries(paths);
    } });
    const refresh = useNotesStore.getState().refresh();
    await history;
    expect(calls[0]).toEqual([today]);
    expect(useNotesStore.getState().previews.has(today)).toBe(true);
    if (week) expect(useNotesStore.getState().previews.has(week)).toBe(true);
    expect(useNotesStore.getState().previews.has(old)).toBe(false);
    const { readNoteIfExists } = await import("@typenotes/mobile-core/core-api");
    expect(await readNoteIfExists(old)).toBe("history");
    release();
    await refresh;
    expect(useNotesStore.getState().previews.has(old)).toBe(true);
  });
  it("applies received edits/additions/deletions without a full tree read", async () => {
    const kept = await createNote(core, "unchanged");
    const edited = await createNote(core, "before");
    const deleted = await createNote(core, "remove");
    await useNotesStore.getState().refresh();
    const untouched = useNotesStore.getState().previews.get(kept);
    await core.writeNote(edited, "received update");
    await core.deleteItems([deleted]);
    const added = await createNote(core, "received addition");
    const tree = JSON.parse(await core.getTree());
    const entries = tree.children.find((node: { path: string }) => node.path === "_system").children
      .find((node: { path: string }) => node.path === "_system/stream").notes
      .filter((entry: { path: string }) => [edited, added].includes(entry.path));
    const treeRead = vi.fn(core.getTree);
    setRawCore({ ...core, getTree: treeRead });
    previewCalls.length = 0;
    await useNotesStore.getState().applySyncChanges({
      status: JSON.parse(await core.getGitStatus()), changed_paths: [edited, deleted, added],
      reset_required: false, entries, removed_paths: [deleted], push_error: null,
      tree_patch: [{ path: "_system/stream", exists: true, note_order: [], folder_order: [] }],
    });
    expect(treeRead).not.toHaveBeenCalled();
    expect(useNotesStore.getState().previews.get(kept)).toBe(untouched);
    expect(useNotesStore.getState().previews.get(edited)?.title).toBe("received update");
    expect(useNotesStore.getState().previews.get(added)?.title).toBe("received addition");
    expect(useNotesStore.getState().previews.has(deleted)).toBe(false);
    expect(useNotesStore.getState().notePaths.has(added)).toBe(true);
    expect(useNotesStore.getState().notePaths.has(deleted)).toBe(false);
  });

  it("drops an incremental result when the working folder changes during its read", async () => {
    const path = await createNote(core, "old workspace");
    useWorkingFolder("delta-old");
    await useNotesStore.getState().refresh();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const entered = vi.fn();
    setRawCore({ ...core, listNoteSummaries: async (paths) => { entered(); await pending; return core.listNoteSummaries(paths); } });
    const apply = useNotesStore.getState().applySyncChanges({
      status: JSON.parse(await core.getGitStatus()), changed_paths: [path], reset_required: false,
      tree_patch: [], entries: [{ path, name: path.split("/").at(-1)!, version: "received" }], removed_paths: [], push_error: null,
    });
    await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
    useWorkingFolder("delta-new");
    release(); await apply;
    expect(useNotesStore.getState().tree).toBeNull();
    expect(useNotesStore.getState().previews.size).toBe(0);
  });

});
