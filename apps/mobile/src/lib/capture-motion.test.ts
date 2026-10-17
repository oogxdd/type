import { describe, expect, it } from "vitest";
import { normalizeAppearance } from "./appearance";
import {
  sheetStartY, releaseFraction, pauseOldOpacity,
  releaseHintOpacity, freshPlaceholderOpacity,
} from "./capture-motion";

describe("fresh page handoff", () => {
  it("reveals the same sheet progressively, including a retracted ready pull", () => {
    for (const height of [180, 455, 850]) {
      expect(sheetStartY(height, 0, "sheet")).toBe(height);
      expect(sheetStartY(height, 83, "sheet")).toBeGreaterThan(sheetStartY(height, 100, "sheet"));
      expect(sheetStartY(height, 1000, "sheet")).toBe(sheetStartY(height, 100, "sheet"));
      expect(sheetStartY(height, 100, "sheet")).toBeGreaterThan(0);
      expect(sheetStartY(height, 0, "gradient")).toBeGreaterThan(height);
    }
    expect(sheetStartY(850, 100, "sheet", 34)).toBe(850 - 126);
  });

  it("lets the hint disappear before the fresh writing prompt, with a blank pause", () => {
    expect(releaseFraction(0)).toBe(.27);
    expect(releaseHintOpacity(0, "pause")).toBe(1);
    expect(pauseOldOpacity(0)).toBe(1);
    // At .64 of the original timeline the old note is gone and the new
    // prompt has not appeared. There must be no old text behind that prompt.
    const silence = (.64 - .27) / .73;
    expect(pauseOldOpacity(silence)).toBe(0);
    expect(freshPlaceholderOpacity(silence, "pause")).toBe(0);
    expect(releaseHintOpacity(silence, "pause")).toBe(0);
    for (const kind of ["layer", "pause"] as const) {
      expect(freshPlaceholderOpacity(1, kind)).toBeCloseTo(1);
      expect(releaseHintOpacity(1, kind)).toBe(0);
    }
  });

  it("keeps old preference files usable and rejects unsupported modes", () => {
    expect(normalizeAppearance({ fontSize: 21 })).toMatchObject({ fontSize: 21, freshNoteTransition: "layer", freshNoteHint: "gradient" });
    expect(normalizeAppearance({ freshNoteTransition: "pause", freshNoteHint: "sheet" })).toMatchObject({ freshNoteTransition: "pause", freshNoteHint: "sheet" });
    expect(normalizeAppearance({ freshNoteTransition: "other", freshNoteHint: 123 })).toMatchObject({ freshNoteTransition: "layer", freshNoteHint: "gradient" });
  });
});
