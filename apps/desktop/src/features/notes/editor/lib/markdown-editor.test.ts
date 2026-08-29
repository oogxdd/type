import { describe, expect, it } from "vitest";
import { htmlToMarkdown, markdownToHtml } from "./markdown-editor";

const emptyParagraphCount = (html: string) =>
  (html.match(/<p><br><\/p>/g) ?? []).length;

describe("markdown editor conversion", () => {
  it("round-trips one empty paragraph without multiplying it", () => {
    const originalHtml = "<p>first</p><p><br></p><p>second</p>";
    const markdown = htmlToMarkdown(originalHtml);
    const restoredHtml = markdownToHtml(markdown);

    expect(markdown).toBe("first\n\n\n\nsecond");
    expect(emptyParagraphCount(restoredHtml)).toBe(1);
    expect(htmlToMarkdown(restoredHtml)).toBe(markdown);
  });

  it("preserves several consecutive empty paragraphs across repeated reloads", () => {
    const originalHtml =
      "<p>first</p><p><br></p><p><br></p><p><br></p><p>second</p>";
    const markdown = htmlToMarkdown(originalHtml);
    const firstReload = markdownToHtml(markdown);
    const secondReload = markdownToHtml(htmlToMarkdown(firstReload));

    expect(emptyParagraphCount(firstReload)).toBe(3);
    expect(emptyParagraphCount(secondReload)).toBe(3);
  });
});
