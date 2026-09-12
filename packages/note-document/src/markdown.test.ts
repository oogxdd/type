// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
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
describe("body tags", () => {
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
