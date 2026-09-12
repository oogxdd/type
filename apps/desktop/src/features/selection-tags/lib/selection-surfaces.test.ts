// @vitest-environment jsdom
/**
 * Vim's Visual modes are the only selection the palette sees that no mouse or
 * Shift+Arrow produced, so this pins the seam between `lib/vim/commands` and
 * the capture the ⌘K handler runs before its focus trap opens.
 */
import { afterEach, describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { history } from "@tiptap/pm/history";
import { buildVimDoc } from "@/features/notes/editor/lib/vim/flat-doc";
import {
  executeVimCommand,
  type VimHost,
} from "@/features/notes/editor/lib/vim/commands";
import { emptyPending, parseVimKey, type VimMode } from "@/features/notes/editor/lib/vim/keys";
import { TagBlock, TagSpan } from "./tagged-blocks";
import { captureTagSelection, registerTagSurface } from "./selection-surfaces";

const schema = getSchema([StarterKit, TagBlock, TagSpan]);
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function editorFixture(texts: string[], wrapped = false) {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const view = new EditorView(mount, {
    state: EditorState.create({
      schema,
      plugins: [history()],
      doc: schema.node(
        "doc",
        null,
        texts.map((text, index) => { const p = schema.node("paragraph", null, text ? schema.text(text) : undefined); return wrapped && index === 0 ? schema.node("tagBlock", { tags: ["work"], flags: {} }, [p]) : p; })
      ),
    }),
  });
  // jsdom has neither focus on contenteditable nor layout: the palette only
  // asks whether the editor owns the selection, and Vim's `scrollIntoView`
  // needs real client rects.
  view.hasFocus = () => true;
  (view as unknown as { scrollToSelection: () => void }).scrollToSelection = () => {};
  const editor = { state: view.state, view, schema, isDestroyed: false } as unknown as Editor;
  Object.defineProperty(editor, "state", { get: () => view.state });
  const surface = { editor, path: "Feed/note.md", editable: true };
  cleanups.push(registerTagSurface(surface));
  cleanups.push(() => { view.destroy(); mount.remove(); });
  return { view, surface };
}

/** The parts of `useVim`'s host a Visual-mode motion touches. */
function vimFixture(texts: string[], wrapped = false) {
  const { view, surface } = editorFixture(texts, wrapped);
  let mode: VimMode = "normal";
  let visualAnchor: number | null = null;
  let visualHead: number | null = null;
  const host = {
    view,
    get mode() { return mode; },
    setMode: (next: VimMode) => { mode = next; },
    get visualAnchor() { return visualAnchor; },
    setVisualAnchor: (index: number | null) => { visualAnchor = index; },
    get visualHead() { return visualHead; },
    setVisualHead: (index: number | null) => { visualHead = index; },
    lastVisual: null,
    setLastVisual: () => {},
    lastFind: null,
    setLastFind: () => {},
    lastChange: null,
    setLastChange: () => {},
    // Geometry is unavailable in jsdom; one logical line is one paragraph here,
    // which is what `j` resolves to in prose anyway.
    moveVisualLines: (direction: -1 | 1, lineCount: number) => {
      const doc = buildVimDoc(view.state.doc);
      const index = doc.toIndex(view.state.selection.head);
      const line = doc.lineNumberAt(index);
      const target = doc.lines[Math.max(0, Math.min(doc.lines.length - 1, line + direction * lineCount))];
      return doc.toPos(target.from);
    },
    halfPageLines: () => 1,
    scrollCursor: () => {},
    indentSelection: () => false,
    splitBlock: () => false,
    undo: () => {},
    redo: () => {},
    closeHistoryPoint: () => {},
    beginInsertCapture: () => {},
  } as unknown as VimHost;

  const press = (keys: string) => {
    let pending = emptyPending();
    for (const key of keys) {
      const result = parseVimKey(pending, { key, char: key, ctrl: false }, host.mode);
      pending = result.kind === "unhandled" ? emptyPending() : result.pending;
      if (result.kind === "command") executeVimCommand(result.command, host);
    }
  };
  return { view, surface, press, get mode() { return mode; } };
}

const capturedIndices = () => captureTagSelection().flatMap(entry => {
  const indices: number[] = []; let index = 0;
  entry.doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    if (entry.blocks.some(range => range.from < pos + node.nodeSize - 1 && range.to > pos + 1)) indices.push(index);
    index++;
  });
  return indices;
});

describe("capturing a selection for the tag palette", () => {
  it("V crosses a container boundary", () => {
    const vim = vimFixture(["first", "second"], true);
    vim.press("Vj");
    expect(capturedIndices()).toEqual([0, 1]);
    expect(captureTagSelection()[0].blocks[0].block).toBe(true);
  });
  it("dd on the only child keeps a valid document and the next paragraph", () => {
    const vim = vimFixture(["first", "second"], true);
    vim.press("dd");
    expect(vim.view.state.doc.textContent).toBe("second");
    expect(() => vim.view.state.doc.check()).not.toThrow();
  });

  it("captures the line under the cursor as soon as Visual Line starts", () => {
    const vim = vimFixture(["first", "second", "third"]);
    vim.press("jV");
    expect(vim.mode).toBe("visual-line");
    expect(capturedIndices()).toEqual([1]);
  });

  it("captures every line a Visual Line selection spans", () => {
    const vim = vimFixture(["first", "second", "third"]);
    vim.press("Vjj");
    expect(capturedIndices()).toEqual([0, 1, 2]);
  });

  it("captures the blocks a charwise Visual selection touches", () => {
    const vim = vimFixture(["first", "second", "third"]);
    vim.press("vj");
    expect(capturedIndices()).toEqual([0, 1]);
  });

  it("captures nothing from Normal mode", () => {
    const vim = vimFixture(["first", "second"]);
    vim.press("j");
    expect(capturedIndices()).toEqual([]);
  });

  it("ignores a collapsed selection left by leaving Visual mode", () => {
    const { view } = editorFixture(["first", "second"]);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 2)));
    expect(capturedIndices()).toEqual([]);
  });
});
