// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Editor, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { DOMParser, DOMSerializer } from "@tiptap/pm/model";
import { TagBlock, TagSpan } from "./tagged-blocks";
import { markdownToHtml, htmlToMarkdown } from "./markdown";
const schema = getSchema([StarterKit, TagBlock, TagSpan]);
function reload(md: string) {
  const el = document.createElement("div"); el.innerHTML = markdownToHtml(md);
  const doc = DOMParser.fromSchema(schema).parse(el);
  el.replaceChildren(DOMSerializer.fromSchema(schema).serializeFragment(doc.content));
  return htmlToMarkdown(el.innerHTML);
}
describe("plain-text spacing", () => {
  for (const count of [1, 2, 3, 4, 5, 8]) {
    for (const source of [
      `first${"\n".repeat(count)}second`,
      `${"\n".repeat(count)}first`,
      `first${"\n".repeat(count)}`,
      "\n".repeat(count),
    ]) it(`preserves whitespace through ten editor reloads: ${JSON.stringify(source)}`, () => {
      let next = source;
      for (let i = 0; i < 10; i++) {
        next = reload(next);
        expect(next).toBe(source);
      }
    });
  }
  it("keeps the different pauses in a stream of thoughts", () => {
    const source = "first\n\nsecond\n\n\nthird\n\n\nfourth\n\n\n\nfifth";
    expect(reload(source)).toBe(source);
    expect((markdownToHtml(source).match(/<p><\/p>/g) ?? []).length).toBe(8);
  });
  for (const blankIndex of [0, 1, 2]) it(`typing in blank line ${blankIndex} does not add line breaks`, () => {
    const source = "\nfirst\n\n\nsecond\n";
    const editor = new Editor({ extensions: [StarterKit], content: markdownToHtml(source) });
    try {
      const blanks: number[] = [];
      editor.state.doc.forEach((node, offset) => { if (!node.content.size) blanks.push(offset + 1); });
      editor.commands.insertContentAt(blanks[blankIndex], "word");
      const saved = htmlToMarkdown(editor.getHTML());
      expect(saved.replace("word", "")).toBe(source);
      expect(reload(saved)).toBe(saved);
    } finally { editor.destroy(); }
  });
  it("Enter inserts exactly one newline", () => {
    const editor = new Editor({ extensions: [StarterKit], content: markdownToHtml("firstsecond") });
    try {
      editor.commands.setTextSelection(6);
      editor.commands.splitBlock();
      const saved = htmlToMarkdown(editor.getHTML());
      expect(saved).toBe("first\nsecond");
      expect(reload(saved)).toBe(saved);
    } finally { editor.destroy(); }
  });
  for (const source of ["- one\n- two", "- one\n- two\n\ntext", "text\n\n- one\n- two", "> first\n>\n> second", "## Heading\n\ntext"]) {
    it(`keeps structured blocks stable: ${source}`, () => {
      const saved = reload(source);
      expect(reload(saved)).toBe(saved);
    });
  }
  it("preserves blank lines containing spaces and Windows line endings", () => {
    expect(reload("first\r\n  \r\n\t\r\nsecond")).toBe("first\n\n\nsecond");
  });
  it("keeps trailing blank lines inside an unfinished code fence literal", () => {
    expect(markdownToHtml("```\nfirst\n\n\n")).toBe("<pre><code>first\n\n</code></pre>\n");
  });
  for (const source of ["```\nfirst\n\n\nsecond\n```", "~~~\nfirst\n\n\n\nsecond\n~~~", "    first\n\n\n    second", "::: #code\n```\nfirst\n\n\nsecond\n```\n:::"]) {
    it(`does not insert spacing markers in code: ${source}`, () => {
      const html = markdownToHtml(source);
      expect(html).not.toContain("NV_EMPTY_LINE_TOKEN");
      expect(html).toContain("first\n\n\n");
      const saved = reload(source);
      expect(reload(saved)).toBe(saved);
    });
  }
});
describe("body tags", () => {
  it("does not extend a tagged paragraph to the following untagged line on save", () => {
    const saved = htmlToMarkdown('<div data-tag-attrs="#skip-ai"><p>private</p></div><p>public</p>');
    expect(saved).toBe("::: #skip-ai\nprivate\n:::\npublic");
    expect(reload(saved)).toBe(saved);
  });
  for (const source of [
    "#todo позвонить в банк", "::: #a\n1\n2\n\n3\n:::", '[text]{who="a}b"}', '[outer [inner]{#b}]{#a}', "::: #urgent researched=true\n## Заголовок\n:::",
    "фраза [вот эта]{#component number=42} внутри", "цвет #fff в середине строки", "# обычный заголовок",
    "#trading_app 😀 привет", String.raw`#trading\_app hello`, "#задача привет\r\nещё",
    ":::: #a\n::: #b\nfirst\n\nsecond\n:::\n::::",
    "::: #skip-ai\nsecret\n\nlast", "::: #a\n```\n#todo code\n:::\n```\n:::",
    "::: #a\n- one\n- two\n:::", "- a [phrase]{#b} here", "[a]{#x}[b]{#x #y}[c]{#y}",
    "::: #a\none\n\n\n\nthree\n:::",
  ]) it(`reloads ten times: ${source}`, () => {
    let next = reload(source);
    for (let i = 0; i < 10; i++) { const again = reload(next); expect(again).toBe(next); next = again; }
  });
  it("keeps code literal", () => { expect(markdownToHtml("```\n#skip-ai code\n``` ")).not.toContain("data-tag-attrs"); });
  it("keeps a repaired one-paragraph private scope through repeated reloads", () => {
    let value = reload("::: #skip-ai\nsecret");
    expect(value).toBe("::: #skip-ai\nsecret\n:::");
    // The repaired fence then follows the same one-paragraph sugar rule.
    value = reload(value);
    expect(value).toBe("#skip-ai secret");
    for (let i = 0; i < 10; i++) expect(reload(value)).toBe(value);
  });
  it("closes an unterminated scope explicitly", () => { expect(reload("::: #skip-ai\nsecret")).toBe("::: #skip-ai\nsecret\n:::"); });
  it("retains a wrapper around another wrapper", () => { expect(reload(":::: #a\n::: #b\nx\n:::\n::::")).toBe("::: #a\n#b x\n:::"); });
  it("flags malformed openers", () => { expect(markdownToHtml("::: #bad!!\nsecret")).toContain("data-tag-invalid"); });
});
