import { describe, expect, it } from "vitest";

import { getAdjacentSettingsSectionId, SETTINGS_SECTIONS } from "./sections";

describe("getAdjacentSettingsSectionId", () => {
  it("moves through settings sections in display order", () => {
    expect(getAdjacentSettingsSectionId("general", 1)).toBe("profile");
    expect(getAdjacentSettingsSectionId("profile", -1)).toBe("general");
  });

  it("clamps at the first and last visible sections", () => {
    const lastSection =
      SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1]?.id ?? "recordings";
    expect(getAdjacentSettingsSectionId("general", -1)).toBe("general");
    expect(getAdjacentSettingsSectionId(lastSection, 1)).toBe(lastSection);
  });
});
