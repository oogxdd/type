// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { constrainSelection, type EditorSurfaceHandle, moveBetweenEditors } from "./editor-surface";
import { TagBlock, TagSpan, assignEditorTag } from "@/features/selection-tags/lib/tagged-blocks";
import { htmlToMarkdown, markdownToHtml } from "./markdown-editor";
const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()); document.body.innerHTML = ""; });
describe("multi-note boundaries", () => {
  function selectionFixture() {
    document.body.innerHTML = '<main><div class="tiptap-content" contenteditable="true"><p>first</p></div><header>divider</header><div class="tiptap-content" contenteditable="true"><p>second</p></div></main>';
    const root = document.querySelector("main")!;
    const [a, b] = root.querySelectorAll("p");
    return { root, a: a.firstChild!, b: b.firstChild! };
  }
  it("clamps forward browser selections before the divider", () => {
    const { root, a, b } = selectionFixture();
    window.getSelection()!.setBaseAndExtent(a, 1, b, 3); constrainSelection(root);
    expect(window.getSelection()!.toString()).toBe("irst");
  });
  it("clamps backwards browser selections to their original note", () => {
    const { root, a, b } = selectionFixture();
    window.getSelection()!.setBaseAndExtent(b, 3, a, 1); constrainSelection(root);
    expect(window.getSelection()!.toString()).toBe("sec");
  });
  function handle(path: string, content = "text"): EditorSurfaceHandle {
    const editor = new Editor({ extensions: [StarterKit.configure({ trailingNode: { notAfter: ["tagBlock"] } }), TagBlock, TagSpan], content: markdownToHtml(content) });
    editors.push(editor);
    // Model a single visual line. Real geometry is exercised in the browser.
    editor.view.endOfTextblock = () => true;
    editor.view.coordsAtPos = () => ({ left: 0, right: 10, top: 0, bottom: 20 });
    editor.view.posAtCoords = () => null;
    return { editor, path, focus: (position) => { editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position))); } };
  }
  it("walks counted vertical motions across files, including empty notes", () => {
    const handles = [handle("A"), handle("B"), handle("C", "")];
    moveBetweenEditors(handles, handles[0], 1, 2, "normal", 0);
    expect(handles[2].editor.state.selection.head).toBe(1);
    moveBetweenEditors(handles, handles[2], -1, 2, "insert", 0);
    expect(handles[0].editor.state.selection.head).toBe(5);
    expect(handles.map((h) => h.editor.getText())).toEqual(["text", "text", ""]);
  });
  it("never crosses documents in visual modes", () => {
    const handles = [handle("A"), handle("B")];
    expect(moveBetweenEditors(handles, handles[0], 1, 2, "visual", 0)).toBe(false);
    expect(moveBetweenEditors(handles, handles[0], 1, 2, "visual-line", 0)).toBe(false);
  });
  it("keeps Markdown tags and undo history local to the assigned note", () => {
    const a = handle("A").editor, b = handle("B").editor;
    assignEditorTag(b, [{ from: 1, to: 5, block: true }], { name: "private", color: "#2563eb" });
    const saved = htmlToMarkdown(b.getHTML());
    expect(saved).toContain("#private");
    expect(htmlToMarkdown(a.getHTML())).toBe("text");
    expect(handle("reopened", saved).editor.getJSON()).toEqual(b.getJSON());
    b.commands.undo();
    expect(htmlToMarkdown(b.getHTML())).toBe("text");
    b.commands.redo();
    expect(htmlToMarkdown(b.getHTML())).toBe(saved);
  });
});
