import { describe, expect, it } from "vitest";
import { prioritizeNotes, reconcileNoteTree } from "./note-loading";
import type { FolderNode } from "@typenotes/shared/types";

describe("large note trees", () => {
  it("prioritizes local today and this Monday-start week over history", () => {
    const now = new Date(2026, 9, 4, 12); // Sunday: the preceding Monday is in this week.
    const file = (date: Date, suffix: string) => ({ name: `${date.toISOString().replace(/\.\d+Z/, "Z").replace(/:/g, "-")}-${suffix}.md`, path: suffix });
    const notes = [file(new Date(2026, 8, 27, 12), "old"), file(new Date(2026, 8, 28, 0), "monday"), file(new Date(2026, 9, 4, 0), "today"), { path: "unknown", name: "unknown.md" }];
    expect(prioritizeNotes(notes, new Map(), now)).toEqual([["today"], ["monday"], ["unknown"], ["old"]]);
    expect(prioritizeNotes(notes, new Map(), new Date(2026, 9, 5, 0))).toEqual([[], [], ["unknown"], ["old", "monday", "today"]]);
  });

  it("preserves Stream references when a note changes elsewhere in a 10,000-note tree", () => {
    const stream: FolderNode = { name: "stream", path: "_system/stream", children: [], notes: Array.from({ length: 10_000 }, (_, index) => ({ path: `stream/${index}.md`, name: `${index}.md`, version: "v1" })) };
    const work: FolderNode = { name: "Work", path: "Work", children: [], notes: [{ path: "Work/a.md", name: "a.md", version: "v1" }] };
    const previous: FolderNode = { name: "root", path: "", children: [stream, work], notes: [] };
    const same = reconcileNoteTree(previous, JSON.parse(JSON.stringify(previous)));
    expect(same).toBe(previous);
    const next = JSON.parse(JSON.stringify(previous)) as FolderNode;
    next.children[1].notes[0].version = "v2";
    const changed = reconcileNoteTree(previous, next);
    expect(changed.children[0]).toBe(stream);
    expect(changed.children[1]).not.toBe(work);
  });
});
