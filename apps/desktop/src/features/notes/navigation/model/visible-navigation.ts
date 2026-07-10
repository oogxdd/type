// The Feed and Folders panes render the same thing: a flat list of visible
// folder/note rows derived from a nested tree. This module owns that shape —
// building the rows from any NavigationNode tree, and moving the selection
// through them with the arrow keys. Folder trees and feed buckets share it.
import type { VisibleNavigationItem } from "@typenotes/shared/types";
import type { NavigationNode } from "./types";

export function buildVisibleNavigationItems(
  nodes: NavigationNode[],
  expanded: Set<string>,
  includeNotes: boolean
): VisibleNavigationItem[] {
  const items: VisibleNavigationItem[] = [];

  const walk = (level: NavigationNode[], parentId: string | null) => {
    level.forEach((node) => {
      items.push({
        type: "folder",
        id: node.id,
        parentId,
      });

      const noteRows = includeNotes ? node.notes ?? [] : [];
      const hasNestedItems = node.children.length > 0 || noteRows.length > 0;
      if (!hasNestedItems || !expanded.has(node.id)) {
        return;
      }

      noteRows.forEach((note) => {
        items.push({
          type: "note",
          id: note.path,
          parentId: node.id,
        });
      });

      walk(node.children, node.id);
    });
  };

  walk(nodes, null);
  return items;
}

export type NavigationKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

export type NavigateVisibleItemsDeps = {
  items: VisibleNavigationItem[];
  /**
   * Selection anchors, most specific first; the first one present in `items`
   * is the row navigation starts from (falling back to the first row).
   */
  preferredIds: Array<string | null>;
  expanded: Set<string>;
  hasNestedItems: (folderId: string) => boolean;
  expand: (folderId: string) => void;
  collapse: (folderId: string) => void;
  selectFolder: (folderId: string) => void;
  selectNote: (notePath: string, parentId: string) => void;
};

/**
 * Arrow-key navigation over a visible-rows list: up/down move the selection,
 * right expands a folder (then enters its first child), left collapses (then
 * climbs to the parent). Notes jump back to their parent folder on left.
 */
export function navigateVisibleItems(
  key: NavigationKey,
  {
    items,
    preferredIds,
    expanded,
    hasNestedItems,
    expand,
    collapse,
    selectFolder,
    selectNote,
  }: NavigateVisibleItemsDeps
): void {
  if (items.length === 0) {
    return;
  }
  const navIds = items.map((item) => item.id);
  const current =
    preferredIds.find((id): id is string => Boolean(id && navIds.includes(id))) ??
    navIds[0];
  const currentIndex = navIds.indexOf(current);
  const currentEntry = items[currentIndex];
  if (!currentEntry) {
    return;
  }

  const selectEntry = (entry: VisibleNavigationItem) => {
    if (entry.type === "folder") {
      selectFolder(entry.id);
      return;
    }
    selectNote(entry.id, entry.parentId);
  };

  if (key === "ArrowUp" || key === "ArrowDown") {
    const delta = key === "ArrowUp" ? -1 : 1;
    const nextIndex = Math.max(0, Math.min(items.length - 1, currentIndex + delta));
    const nextEntry = items[nextIndex];
    if (nextEntry) {
      selectEntry(nextEntry);
    }
    return;
  }

  if (key === "ArrowRight") {
    if (currentEntry.type !== "folder" || !hasNestedItems(currentEntry.id)) {
      return;
    }
    if (!expanded.has(currentEntry.id)) {
      expand(currentEntry.id);
      return;
    }
    const firstChildEntry = items[currentIndex + 1];
    if (!firstChildEntry || firstChildEntry.parentId !== currentEntry.id) {
      return;
    }
    selectEntry(firstChildEntry);
    return;
  }

  // ArrowLeft
  if (currentEntry.type === "note") {
    selectFolder(currentEntry.parentId);
    return;
  }
  if (hasNestedItems(currentEntry.id) && expanded.has(currentEntry.id)) {
    collapse(currentEntry.id);
    return;
  }
  const parentId = currentEntry.parentId;
  if (!parentId) {
    return;
  }
  collapse(parentId);
  selectFolder(parentId);
}
