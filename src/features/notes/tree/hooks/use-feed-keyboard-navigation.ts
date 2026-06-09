import {
  useCallback,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type SetStateAction,
} from "react";

import type { FeedTreeNode } from "@/features/notes/lib/feed-tree-model";
import { FEED_FOLDER_PATH } from "@/shared/constants";
import { escapeSelectorValue, focusNoScroll, scrollIntoViewIfNeeded } from "@/shared/lib/dom";
import type { VisibleNavigationItem } from "@/shared/types";

type UseFeedKeyboardNavigationArgs = {
  shouldNestNotesInNavigation: boolean;
  feedVisibleNavigationItems: VisibleNavigationItem[];
  feedNodeById: Map<string, FeedTreeNode>;
  expanded: Set<string>;
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
  activeFeedGroup: string;
  setActiveFeedGroup: (path: string) => void;
  activeNote: string | null;
  lastSelectedFolder: string;
  lastSelectedNote: string;
  setSelectedFolders: Dispatch<SetStateAction<Set<string>>>;
  setLastSelectedFolder: (path: string) => void;
  setActiveFolder: (path: string) => void;
  setSelectedNotes: Dispatch<SetStateAction<Set<string>>>;
  setLastSelectedNote: (path: string) => void;
  setActiveNote: (path: string | null) => void;
  foldersPanelRef: RefObject<HTMLDivElement | null>;
};

export function useFeedKeyboardNavigation({
  shouldNestNotesInNavigation,
  feedVisibleNavigationItems,
  feedNodeById,
  expanded,
  setExpanded,
  activeFeedGroup,
  setActiveFeedGroup,
  activeNote,
  lastSelectedFolder,
  lastSelectedNote,
  setSelectedFolders,
  setLastSelectedFolder,
  setActiveFolder,
  setSelectedNotes,
  setLastSelectedNote,
  setActiveNote,
  foldersPanelRef,
}: UseFeedKeyboardNavigationArgs) {
  return useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (feedVisibleNavigationItems.length === 0) return;
      event.preventDefault();

      const navIds = feedVisibleNavigationItems.map((item) => item.id);
      const current =
        lastSelectedNote && navIds.includes(lastSelectedNote)
          ? lastSelectedNote
          : lastSelectedFolder && navIds.includes(lastSelectedFolder)
            ? lastSelectedFolder
            : activeNote && navIds.includes(activeNote)
              ? activeNote
              : activeFeedGroup && navIds.includes(activeFeedGroup)
                ? activeFeedGroup
                : navIds[0];
      const currentIndex = Math.max(0, navIds.indexOf(current));
      const currentEntry = feedVisibleNavigationItems[currentIndex];
      if (!currentEntry) return;

      const selectFeedGroup = (groupPath: string) => {
        setActiveFeedGroup(groupPath);
        setSelectedFolders(new Set([FEED_FOLDER_PATH]));
        setLastSelectedFolder(FEED_FOLDER_PATH);
        setActiveFolder(FEED_FOLDER_PATH);
        setSelectedNotes(new Set());
        setLastSelectedNote("");
        setActiveNote(null);
        focusNoScroll(foldersPanelRef.current);
        requestAnimationFrame(() => {
          scrollIntoViewIfNeeded(
            foldersPanelRef.current,
            `[data-folder="${escapeSelectorValue(groupPath)}"]`
          );
        });
      };

      const selectFeedNote = (notePath: string, parentPath: string) => {
        setActiveFeedGroup(parentPath);
        setSelectedFolders(new Set([FEED_FOLDER_PATH]));
        setLastSelectedFolder(FEED_FOLDER_PATH);
        setActiveFolder(FEED_FOLDER_PATH);
        setSelectedNotes(new Set([notePath]));
        setLastSelectedNote(notePath);
        setActiveNote(notePath);
        focusNoScroll(foldersPanelRef.current);
        requestAnimationFrame(() => {
          scrollIntoViewIfNeeded(
            foldersPanelRef.current,
            `[data-note="${escapeSelectorValue(notePath)}"]`
          );
        });
      };

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const delta = event.key === "ArrowUp" ? -1 : 1;
        const nextIndex = Math.max(
          0,
          Math.min(feedVisibleNavigationItems.length - 1, currentIndex + delta)
        );
        const nextEntry = feedVisibleNavigationItems[nextIndex];
        if (!nextEntry) return;
        if (nextEntry.type === "folder") {
          selectFeedGroup(nextEntry.id);
          return;
        }
        selectFeedNote(nextEntry.id, nextEntry.parentId);
        return;
      }

      if (event.key === "ArrowRight") {
        if (currentEntry.type !== "folder") return;
        const feedItem = feedNodeById.get(currentEntry.id);
        const hasNestedItems =
          Boolean(feedItem?.children.length) ||
          Boolean(shouldNestNotesInNavigation && feedItem?.notes.length);
        if (!hasNestedItems) return;
        if (!expanded.has(currentEntry.id)) {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.add(currentEntry.id);
            return next;
          });
          return;
        }
        const firstChildEntry = feedVisibleNavigationItems[currentIndex + 1];
        if (!firstChildEntry || firstChildEntry.parentId !== currentEntry.id) return;
        if (firstChildEntry.type === "folder") {
          selectFeedGroup(firstChildEntry.id);
          return;
        }
        selectFeedNote(firstChildEntry.id, firstChildEntry.parentId);
        return;
      }

      if (event.key === "ArrowLeft") {
        if (currentEntry.type === "note") {
          selectFeedGroup(currentEntry.parentId);
          return;
        }

        const feedItem = feedNodeById.get(currentEntry.id);
        const hasNestedItems =
          Boolean(feedItem?.children.length) ||
          Boolean(shouldNestNotesInNavigation && feedItem?.notes.length);
        if (hasNestedItems && expanded.has(currentEntry.id)) {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.delete(currentEntry.id);
            return next;
          });
          return;
        }
        const parentFeedId = currentEntry.parentId;
        if (!parentFeedId) return;
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(parentFeedId);
          return next;
        });
        selectFeedGroup(parentFeedId);
      }
    },
    [
      activeFeedGroup,
      activeNote,
      expanded,
      feedNodeById,
      feedVisibleNavigationItems,
      foldersPanelRef,
      lastSelectedFolder,
      lastSelectedNote,
      setActiveFeedGroup,
      setActiveFolder,
      setActiveNote,
      setExpanded,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
      shouldNestNotesInNavigation,
    ]
  );
}
