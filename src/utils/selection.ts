import type { MouseEvent as ReactMouseEvent } from "react";

type SelectionModifiers = Pick<ReactMouseEvent, "shiftKey" | "metaKey" | "ctrlKey">;

/**
 * Translate a click (with modifier keys) into the next selection set, matching
 * Finder-style behavior:
 *
 * - **Shift+click** selects the contiguous range between the last-selected item
 *   and the clicked one (falling back to a single selection if either id is not
 *   in `order`).
 * - **Cmd/Ctrl+click** toggles the clicked item in/out of the selection.
 * - A **plain click** selects only the clicked item.
 *
 * `order` is the flat, top-to-bottom list of selectable ids used to resolve the
 * shift range.
 */
export function computeRangeSelection(
  event: SelectionModifiers,
  current: Set<string>,
  order: string[],
  lastSelected: string | null,
  path: string
): Set<string> {
  const next = new Set(current);
  if (event.shiftKey && lastSelected) {
    next.clear();
    const start = order.indexOf(lastSelected);
    const end = order.indexOf(path);
    if (start !== -1 && end !== -1) {
      const [from, to] = start < end ? [start, end] : [end, start];
      order.slice(from, to + 1).forEach((id) => next.add(id));
    } else {
      next.add(path);
    }
  } else if (event.metaKey || event.ctrlKey) {
    if (next.has(path)) next.delete(path);
    else next.add(path);
  } else {
    next.clear();
    next.add(path);
  }
  return next;
}

/**
 * Resolve which paths a context-menu action should target: the whole selection
 * when the right-clicked item is part of a multi-selection, otherwise just the
 * clicked item.
 */
export function resolveTargetPaths(selected: Set<string>, path: string): string[] {
  return selected.size > 1 && selected.has(path) ? Array.from(selected) : [path];
}
