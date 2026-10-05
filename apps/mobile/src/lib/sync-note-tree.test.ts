import { describe, expect, it } from "vitest";
import type { FolderNode, GitSyncFolderPatch } from "@typenotes/shared/types";
import { applySyncTreePatch } from "./sync-note-tree";

const folder = (path: string, names: string[] = [], children: FolderNode[] = []): FolderNode => ({ path, name: path.split("/").at(-1) || "Notes", children, notes: names.map((name) => ({ name, path: `${path}/${name}`, version: "old" })) });
const patch = (path: string, note_order: string[] = [], folder_order: string[] = [], exists = true): GitSyncFolderPatch => ({ path, exists, note_order, folder_order });

describe("incremental sync tree", () => {
  it("updates one of 10k Stream entries while retaining unrelated rows/folders", () => {
    const stream = folder("_system/stream", Array.from({ length: 10000 }, (_, i) => `${String(10000 - i).padStart(5, "0")}.md`));
    const work = folder("Work", ["keep.md"]);
    const tree = folder("", [], [folder("_system", [], [stream]), work]);
    const next = applySyncTreePatch(tree, [{ ...stream.notes[5], version: "new" }], [], [patch("_system/stream")]);
    expect(next.children[1]).toBe(work);
    expect(next.children[0].children[0].notes[4]).toBe(stream.notes[4]);
    expect(next.children[0].children[0].notes[5].version).toBe("new");
  });
  it("moves notes into new nested folders using persisted ordering", () => {
    const tree = folder("", [], [folder("Work", ["removed.md", "kept.md"])]);
    const next = applySyncTreePatch(tree, [{ path: "New/Nested/z.md", name: "z.md", version: "1" }, { path: "New/Nested/a.md", name: "a.md", version: "1" }], ["Work/removed.md"], [patch("", [], ["Work", "New"]), patch("New"), patch("New/Nested", ["z.md", "a.md"])]);
    expect(next.children[0].notes.map((note) => note.name)).toEqual(["kept.md"]);
    expect(next.children[1].children[0].notes.map((note) => note.name)).toEqual(["z.md", "a.md"]);
  });
  it("removes vanished folders and excludes dot/system storage entries", () => {
    const tree = folder("", [], [folder("Work", ["gone.md"])]);
    const next = applySyncTreePatch(tree, [{ name: "hidden.md", path: "_system/agent/hidden.md", version: "1" }], ["Work/gone.md"], [patch("Work", [], [], false), patch("_system/agent"), patch(".private")]);
    expect(next.children).toEqual([]);
  });
  it("retains a recreated note whose newer read supersedes an absent folder snapshot", () => {
    const tree = folder("", [], [folder("Work", ["same.md"])]);
    const next = applySyncTreePatch(tree, [{ name: "same.md", path: "Work/same.md", version: "recreated" }], [], [patch("Work", [], [], false)]);
    expect(next.children[0].notes[0].version).toBe("recreated");
  });

});
