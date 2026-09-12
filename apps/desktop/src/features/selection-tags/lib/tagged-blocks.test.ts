import { TagColors, tagColorsKey } from "@/features/tags/lib/tag-colors";
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TagBlock, TagSpan, assignEditorTag } from "./tagged-blocks";
import { markdownToHtml, htmlToMarkdown } from "@typenotes/note-document/markdown";
const editors: Editor[] = [];
const make = (md: string) => { const editor = new Editor({ extensions: [StarterKit.configure({ trailingNode: { notAfter: ["tagBlock"] } }), TagBlock, TagSpan, TagColors], content: markdownToHtml(md) }); editors.push(editor); return editor; };
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); });
const tag = { name: "work", color: "#8b5cf6" };
describe("body tag assignment", () => {
  it("adds a second tag to the same range without nesting another frame", () => {
    const editor = make("#work first");
    assignEditorTag(editor, [{ from: 2, to: 7, block: true }], { name: "other", color: "#abcdef" });
    expect(editor.state.doc.firstChild?.attrs.tags).toEqual(["work", "other"]);
    expect(editor.state.doc.firstChild?.firstChild?.type.name).toBe("paragraph");
  });
  it("updates registry colors through decorations without changing stored Markdown", () => {
    const editor = make("#work first [phrase]{#other}");
    const before = editor.getHTML();
    editor.view.dispatch(editor.state.tr.setMeta(tagColorsKey, new Map([["work", "#123456"], ["other", "#abcdef"]])));
    expect(editor.getHTML()).toBe(before);
    expect(editor.view.dom.innerHTML).toContain("#123456");
    expect(editor.view.dom.innerHTML).toContain("#abcdef");
    expect(editor.view.dom.querySelector<HTMLElement>("[data-tag-inline]")?.style.getPropertyValue("--selection-tag-color")).toBe("#abcdef");
    editor.view.dispatch(editor.state.tr.setMeta(tagColorsKey, new Map()));
    expect(editor.view.dom.querySelector<HTMLElement>("[data-tag-inline]")?.style.getPropertyValue("--selection-tag-color")).toBe("#8b5cf6");
  });

  it("wraps multiple paragraphs with one node and persists through Markdown", () => {
    const editor = make("first\n\nsecond\n\nthird");
    assignEditorTag(editor, [{ from: 1, to: 14, block: true }], tag);
    expect(editor.state.doc.firstChild?.type.name).toBe("tagBlock");
    expect(editor.state.doc.firstChild?.childCount).toBe(2);
    const reopened = make(htmlToMarkdown(editor.getHTML()));
    expect(reopened.getJSON()).toEqual(editor.getJSON());
  });
  it("splits overlapping phrase tags and unions names", () => {
    const editor = make("abcdef");
    assignEditorTag(editor, [{ from: 1, to: 5, block: false }], tag);
    assignEditorTag(editor, [{ from: 3, to: 7, block: false }], { name: "other", color: "#123456" });
    expect(htmlToMarkdown(editor.getHTML())).toBe("[ab]{#work}[cd]{#work #other}[ef]{#other}");
  });
  it("makes assignment a separate undo step from typing on either side", () => {
    const editor = make("first");
    editor.commands.insertContentAt(6, "!");
    assignEditorTag(editor, [{ from: 1, to: 7, block: true }], tag);
    editor.commands.insertContentAt(3, "x");
    editor.commands.undo(); expect(editor.state.doc.firstChild?.type.name).toBe("tagBlock");
    editor.commands.undo(); expect(htmlToMarkdown(editor.getHTML())).toBe("first!");
    editor.commands.redo(); expect(editor.state.doc.firstChild?.attrs.tags).toEqual(["work"]);
  });
  it("pasted tagged HTML carries names and flags", () => {
    const editor = make('[phrase]{#work number=42}');
    const pasted = new Editor({ extensions: [StarterKit.configure({ trailingNode: { notAfter: ["tagBlock"] } }), TagBlock, TagSpan, TagColors], content: editor.getHTML() }); editors.push(pasted);
    expect(pasted.getJSON()).toEqual(editor.getJSON());
  });
  it("Enter exits the last child and Backspace unwraps at the start", () => {
    const editor = make("#work first");
    editor.commands.setTextSelection(7);
    expect(editor.view.someProp("handleKeyDown", handler => handler(editor.view, new KeyboardEvent("keydown", { key: "Enter" })))).toBe(true);
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.selection.$from.depth).toBe(1);
    editor.commands.setTextSelection(2);
    expect(editor.view.someProp("handleKeyDown", handler => handler(editor.view, new KeyboardEvent("keydown", { key: "Backspace" })))).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
  });
});
