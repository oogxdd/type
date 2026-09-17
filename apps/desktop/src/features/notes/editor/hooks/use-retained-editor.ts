import { Editor, type EditorOptions } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";

type Lease = {
  editor: Editor;
  options: Partial<EditorOptions>;
  markdown: string;
  release?: ReturnType<typeof setTimeout>;
};

/** Park the editor's own schema/state/history while destroying its DOM view. */
export class EditorPool {
  private entries = new Map<string, Lease>();
  private disposal?: ReturnType<typeof setTimeout>;
  get(path: string) { return this.entries.get(path); }
  set(path: string, lease: Lease) { this.entries.set(path, lease); }
  retain(paths: Set<string>) {
    for (const [path, lease] of this.entries) {
      if (paths.has(path)) continue;
      this.entries.delete(path);
      clearTimeout(lease.release);
      lease.release = setTimeout(() => lease.editor.destroy(), 0);
    }
  }
  activate() { clearTimeout(this.disposal); }
  dispose() {
    // React StrictMode replays effects; only a real departure destroys history.
    this.disposal = setTimeout(() => {
      for (const lease of this.entries.values()) {
        clearTimeout(lease.release);
        lease.editor.destroy();
      }
      this.entries.clear();
    }, 0);
  }
}

/** Same editor across viewport remounts, but no offscreen EditorView/listeners. */
export function useRetainedEditor(
  options: Partial<EditorOptions>,
  pool: EditorPool | undefined,
  path: string | null,
  getMarkdown: () => string,
) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const markdownRef = useRef(getMarkdown);
  markdownRef.current = getMarkdown;
  const leaseRef = useRef<Lease | null>(null);
  const ownerRef = useRef({ pool, path });
  const [editor, setEditor] = useState<Editor | null>(null);
  useEffect(() => {
    let lease = path ? pool?.get(path) : undefined;
    if (ownerRef.current.pool === pool && ownerRef.current.path === path) lease ??= leaseRef.current ?? undefined;
    ownerRef.current = { pool, path };
    if (!lease) {
      // Event proxies read the latest component callbacks after a remount.
      const entry = { options: optionsRef.current, markdown: markdownRef.current() } as Lease;
      const instance = new Editor({
        ...entry.options,
        onFocus: (event) => entry.options.onFocus?.(event),
        onBlur: (event) => entry.options.onBlur?.(event),
        onUpdate: (event) => entry.options.onUpdate?.(event),
        onSelectionUpdate: (event) => entry.options.onSelectionUpdate?.(event),
        onTransaction: (event) => entry.options.onTransaction?.(event),
      });
      entry.editor = instance;
      lease = entry;
      if (path) pool?.set(path, lease);
    } else {
      clearTimeout(lease.release);
      lease.options = optionsRef.current;
      lease.editor.setOptions({ editorProps: lease.options.editorProps ?? {} });
      if (lease.editor.isDestroyed) lease.editor.mount(document.createElement("div"));
    }
    leaseRef.current = lease;
    setEditor(lease.editor);
    return () => {
      lease.markdown = markdownRef.current();
      lease.release = setTimeout(() => {
        // Read state before unmount: Tiptap stores the latest PM state here.
        void lease.editor.state;
        if (pool && path) {
          lease.editor.unmount();
          lease.options = {};
        } else lease.editor.destroy();
      }, 0);
    };
  }, [pool, path]);
  useEffect(() => {
    const lease = leaseRef.current;
    if (!lease || lease.editor.isDestroyed) return;
    lease.options = optionsRef.current;
    // While mounted, editorProps use stable Vim/surface refs.
  });
  return editor;
}
