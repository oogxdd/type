import { describe, expect, it } from "vitest";
import fixtures from "../test-fixtures/note-previews.json";
import { parseNotePreview } from "./format";
import type { NoteMeta } from "./types";

describe("compact native preview contract", () => {
  for (const fixture of fixtures) {
    it(fixture.body.slice(0, 50) || "empty attachment", () => {
      const preview = parseNotePreview(fixture.body, null, { created_ms: null, updated_ms: null, ...fixture.meta } as NoteMeta);
      expect(preview.title).toBe(fixture.title);
      expect(preview.secondLine).toBe(fixture.secondLine);
    });
  }
});
