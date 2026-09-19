import { describe, expect, it } from "vitest";
import { htmlToMarkdown, markdownToHtml } from "./markdown-editor";

const emptyParagraphCount = (html: string) =>
  (html.match(/<p><\/p>/g) ?? []).length;

describe("markdown editor conversion", () => {
  it("keeps one plain-text blank line across repeated reloads", () => {
    const markdown = "first\n\nsecond";
    let currentMarkdown = markdown;

    for (let reopen = 0; reopen < 10; reopen += 1) {
      currentMarkdown = htmlToMarkdown(markdownToHtml(currentMarkdown));
      expect(currentMarkdown).toBe(markdown);
    }
  });

  it("round-trips one empty paragraph without multiplying it", () => {
    const originalHtml = "<p>first</p><p></p><p>second</p>";
    const markdown = htmlToMarkdown(originalHtml);
    let restoredHtml = markdownToHtml(markdown);

    expect(markdown).toBe("first\n\nsecond");
    for (let reopen = 0; reopen < 10; reopen += 1) {
      expect(emptyParagraphCount(restoredHtml)).toBe(1);
      expect(htmlToMarkdown(restoredHtml)).toBe(markdown);
      restoredHtml = markdownToHtml(htmlToMarkdown(restoredHtml));
    }
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
