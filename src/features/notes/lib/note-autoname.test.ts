import { describe, expect, it } from "vitest";
import { buildSlugFromContent, getAutoRenameTarget } from "./note-autoname";

describe("buildSlugFromContent", () => {
  it("builds a slug from user-authored markdown only", () => {
    const markdown = [
      "---",
      "created_ms: 1",
      "---",
      "# Morning reflection",
      "type_annotations_b64: AAAAAAAAAAAAAAAA",
      "",
      "Important plan for today.",
      "",
      "<!-- type:lens:v1",
      "{\"notes\":[]}",
      "-->",
    ].join("\n");

    expect(buildSlugFromContent(markdown)).toBe(
      "morning-reflection-important-plan-for-today"
    );
  });

  it("keeps unicode letters in slugs", () => {
    expect(buildSlugFromContent("заметка про утро и кофе")).toBe(
      "заметка-про-утро-и-кофе"
    );
  });
});

describe("getAutoRenameTarget", () => {
  it("renames timestamp placeholders to content slugs", () => {
    expect(
      getAutoRenameTarget(
        "Feed/2026-06-08T12-00-00Z-note-abcdef12.md",
        "A useful morning reflection",
        "utc_timestamp_slug"
      )
    ).toBe("2026-06-08T12-00-00Z-a-useful-morning-reflection.md");
  });

  it("leaves explicit timestamp suffixes alone", () => {
    expect(
      getAutoRenameTarget(
        "Feed/2026-06-08T12-00-00Z-already-good-title.md",
        "A different body",
        "utc_timestamp_slug"
      )
    ).toBeNull();
  });

  it("does not rename uuid-only format notes", () => {
    expect(
      getAutoRenameTarget(
        "Feed/018fa2b1-2b3c-7d4e-8f00-123456789abc.md",
        "A useful morning reflection",
        "uuid_v7"
      )
    ).toBeNull();
  });

  it("renames uuid-prefix placeholders when that format is selected", () => {
    expect(
      getAutoRenameTarget(
        "Feed/018fa2b1-2b3c-note.md",
        "A useful morning reflection",
        "uuid_v7_prefix_slug"
      )
    ).toBe("018fa2b1-2b3c-a-useful-morning-reflection.md");
  });
});
