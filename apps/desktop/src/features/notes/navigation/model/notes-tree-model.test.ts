import { describe, expect, it } from "vitest";

import { STREAM_FOLDER_PATH } from "@typenotes/shared/constants";
import type { NoteEntry } from "@typenotes/shared/types";
import { selectPreviewSourceNotes } from "./notes-tree-model";

const note = (path: string): NoteEntry => ({
  path,
  name: path.split("/").pop() || path,
});

describe("selectPreviewSourceNotes", () => {
  it("loads only stream notes while the stream is selected", () => {
    const feedNotes = [
      note(`${STREAM_FOLDER_PATH}/one.md`),
      note(`${STREAM_FOLDER_PATH}/two.md`),
    ];
    const allNotes = [...feedNotes, note("Projects/three.md")];

    expect(
      selectPreviewSourceNotes({
        activeFolder: STREAM_FOLDER_PATH,
        notes: feedNotes,
        feedNotes,
        allNotes,
        shouldNestNotesInNavigation: true,
      })
    ).toEqual(feedNotes);
  });
});
