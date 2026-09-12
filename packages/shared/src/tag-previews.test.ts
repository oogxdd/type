import { it, expect } from "vitest";
import { parseNotePreview } from "./format";
it("strips tag delimiters, names and flags from titles and preview text", () => {
  const preview = parseNotePreview('::: #urgent researched=true\n#todo Call the [bank]{#component number=42}\n\nsecond\n:::', null, { created_ms: null, tags: ["note-wide"] });
  expect(preview.title).toBe("Call the bank");
  expect(preview.secondLine).toBe("second");
  expect(preview.tags).toEqual(["note-wide"]);
});
