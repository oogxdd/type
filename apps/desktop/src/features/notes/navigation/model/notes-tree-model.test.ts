import { describe, expect, it } from "vitest";

import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";
import type { NoteEntry } from "@typenotes/shared/types";
import { selectPreviewSourceNotes } from "./notes-tree-model";

const note = (path: string): NoteEntry => ({
  path,
  name: path.split("/").pop() || path,
});

describe("selectPreviewSourceNotes", () => {
  it("loads only Feed notes while Feed is selected", () => {
    const feedNotes = [note("Feed/one.md"), note("Feed/two.md")];
    const allNotes = [...feedNotes, note("Projects/three.md")];

    expect(
      selectPreviewSourceNotes({
        layoutMode: "desktop",
        activeFolder: FEED_FOLDER_PATH,
        activeNote: null,
        notes: feedNotes,
        feedNotes,
        allNotes,
        shouldNestNotesInNavigation: true,
      })
    ).toEqual(feedNotes);
  });
});
