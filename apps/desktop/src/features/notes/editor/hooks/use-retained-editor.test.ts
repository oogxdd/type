// @vitest-environment jsdom
import { act, createElement, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { EditorPool, useRetainedEditor } from "./use-retained-editor";

afterEach(() => vi.useRealTimers());
describe("parked note editors", () => {
  it("releases the DOM view, then restores the same document and Undo history", async () => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const pool = new EditorPool();
    let current: Editor | null = null;
    function Probe() {
      const editor = useRetainedEditor({
        extensions: [StarterKit], content: "<p>first</p>", autofocus: false,
      }, pool, "A", () => current?.getText() ?? "first");
      useEffect(() => { if (editor) current = editor; }, [editor]);
      return createElement(EditorContent, { editor });
    }
    try {
      await act(async () => { root.render(createElement(StrictMode, null, createElement(Probe))); });
      const first = current!;
      await act(async () => { first.commands.insertContent("edit "); });
      const text = first.getText();
      await act(async () => { root.render(null); });
      await act(async () => { await vi.advanceTimersByTimeAsync(2); });
      expect(first.isDestroyed).toBe(true); // no live EditorView
      expect(container.querySelector("[contenteditable]")).toBeNull();
      await act(async () => { root.render(createElement(StrictMode, null, createElement(Probe))); });
      expect(current).toBe(first);
      expect(first.getText()).toBe(text);
      await act(async () => { first.commands.undo(); });
      expect(first.getText()).toBe("first");
      await act(async () => { first.commands.redo(); });
      expect(first.getText()).toBe(text);
    } finally {
      await act(async () => { root.unmount(); pool.dispose(); await vi.runAllTimersAsync(); });
      container.remove();
      Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    }
  });
});
