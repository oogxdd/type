/**
 * The single listener behind `keymap.ts`, and the hook features use to claim a
 * shortcut.
 *
 * Every surface used to install its own `window`/`document` listener, which
 * meant precedence was decided by mount order and by whoever called
 * `stopPropagation` first. There is now one capture-phase listener: it matches
 * the event against the keymap, and only then stops it — so a chord that is not
 * in the table reaches the editor untouched, and a chord that is cannot be
 * swallowed by an unrelated feature.
 *
 * Handlers live in a module registry rather than in context so that
 * `shared/` stays a leaf: features register from wherever they already are.
 */

import { useEffect, useRef } from "react";
import { matchShortcut, type ShortcutId } from "./keymap";

type Handler = () => void;

const handlers = new Map<ShortcutId, Set<Handler>>();

function register(id: ShortcutId, handler: Handler) {
  const existing = handlers.get(id) ?? new Set<Handler>();
  existing.add(handler);
  handlers.set(id, existing);
  return () => {
    existing.delete(handler);
    if (!existing.size) handlers.delete(id);
  };
}

/** Whether a text editor owns focus — see `ShortcutBinding.owner`. */
function editorHasFocus() {
  const active = document.activeElement;
  return Boolean(
    active instanceof HTMLElement &&
      (active.isContentEditable ||
        active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA")
  );
}

/** Claims a shortcut while the component is mounted. */
export function useGlobalShortcut(id: ShortcutId, handler: Handler) {
  // Callers pass inline closures over live state; the registry holds a stable
  // proxy so a re-render never has to re-register.
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => register(id, () => latest.current()), [id]);
}

/** Mounted once, at the composition root. */
export function useGlobalShortcutDispatcher() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const id = matchShortcut(event, { editorFocused: editorHasFocus() });
      if (!id) return;
      const claimed = handlers.get(id);
      if (!claimed?.size) return;
      event.preventDefault();
      // Capture pane shortcuts before contenteditable/Tiptap key handlers. On
      // macOS, Control+T and Control+W otherwise reach the editor first and
      // behave differently from their Command-key equivalents.
      event.stopPropagation();
      for (const handler of [...claimed]) handler();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);
}
