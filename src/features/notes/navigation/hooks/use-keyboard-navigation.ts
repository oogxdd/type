import { useCallback, useRef } from "react";
import type { AppMode, VisibleNavigationItem } from "@/shared/types";
import type { FlattenedItem } from "../model/types";
import { focusNoScroll, scrollIntoViewIfNeeded, escapeSelectorValue } from "@/shared/lib/dom";
import { usePaneShortcuts } from "./use-pane-shortcuts";
import type { FeedTreeNode } from "@/features/notes/navigation/model/feed-tree-model";
import { useFeedKeyboardNavigation } from "./use-feed-keyboard-navigation";

type UseKeyboardNavigationArgs = {
  layoutMode: string;
  appMode: AppMode;
  shouldNestNotesInNavigation: boolean;
  sidebarCollapsed: boolean;
  increaseEditorFontSize: () => void;
  decreaseEditorFontSize: () => void;
  resetEditorFontSize: () => void;
  createNewNote: () => Promise<string | null>;
  deleteSelectedNotes: () => void;
  lockAppNow: () => Promise<void>;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  // Tree data
  visibleItems: FlattenedItem[];
  orderedIds: string[];
  flatItemById: Map<string, FlattenedItem>;
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  visibleNavigationItems: VisibleNavigationItem[];
  activeNavigationTab: "feed" | "folders";
  feedVisibleNavigationItems: VisibleNavigationItem[];
  feedNodeById: Map<string, FeedTreeNode>;
  // Selection state
  activeFolder: string;
  lastSelectedFolder: string;
  setSelectedFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
  setLastSelectedFolder: (path: string) => void;
  setActiveFolder: (path: string) => void;
  activeNote: string | null;
  lastSelectedNote: string;
  setSelectedNotes: React.Dispatch<React.SetStateAction<Set<string>>>;
  setLastSelectedNote: (path: string) => void;
  setActiveNote: (path: string | null) => void;
  notes: Array<{ path: string }>;
  activeFeedGroup: string;
  setActiveFeedGroup: (path: string) => void;
  // Refs
  foldersPanelRef: React.RefObject<HTMLDivElement | null>;
  middlePaneRef: React.RefObject<HTMLDivElement | null>;
  rightPaneRef: React.RefObject<HTMLDivElement | null>;
  notesPanelRef: React.RefObject<HTMLDivElement | null>;
};

export function useKeyboardNavigation({
  layoutMode,
  appMode,
  shouldNestNotesInNavigation,
  sidebarCollapsed,
  increaseEditorFontSize,
  decreaseEditorFontSize,
  resetEditorFontSize,
  createNewNote,
  deleteSelectedNotes,
  lockAppNow,
  setSidebarCollapsed,
  visibleItems,
  orderedIds,
  flatItemById,
  expanded,
  setExpanded,
  visibleNavigationItems,
  activeNavigationTab,
  feedVisibleNavigationItems,
  feedNodeById,
  activeFolder,
  lastSelectedFolder,
  setSelectedFolders,
  setLastSelectedFolder,
  setActiveFolder,
  activeNote,
  lastSelectedNote,
  setSelectedNotes,
  setLastSelectedNote,
  setActiveNote,
  notes,
  activeFeedGroup,
  setActiveFeedGroup,
  foldersPanelRef,
  middlePaneRef,
  rightPaneRef,
  notesPanelRef,
}: UseKeyboardNavigationArgs) {
  const lastLeftPaneFocusRef = useRef<"folders" | "middle">("middle");

  usePaneShortcuts({
    layoutMode,
    appMode,
    shouldNestNotesInNavigation,
    sidebarCollapsed,
    increaseEditorFontSize,
    decreaseEditorFontSize,
    resetEditorFontSize,
    createNewNote,
    deleteSelectedNotes,
    lockAppNow,
    setSidebarCollapsed,
    foldersPanelRef,
    middlePaneRef,
    rightPaneRef,
    lastLeftPaneFocusRef,
  });
  const handleFeedKeyboardNavigation = useFeedKeyboardNavigation({
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
  });

  // -- Notes list keyboard handler
  const handleNotesKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        if ((event.metaKey || event.ctrlKey) && event.key === "ArrowLeft") {
          event.preventDefault();
          lastLeftPaneFocusRef.current = "folders";
          focusNoScroll(foldersPanelRef.current);
        }
        return;
      }
      if (notes.length === 0) return;
      event.preventDefault();
      const notePaths = notes.map((n) => n.path);
      const current =
        lastSelectedNote && notePaths.includes(lastSelectedNote)
          ? lastSelectedNote
          : activeNote || notePaths[0];
      const currentIndex = notePaths.indexOf(current);
      const delta = event.key === "ArrowUp" ? -1 : 1;
      const nextIndex = Math.max(0, Math.min(notePaths.length - 1, currentIndex + delta));
      const nextPath = notePaths[nextIndex];
      setSelectedNotes(new Set([nextPath]));
      setLastSelectedNote(nextPath);
      setActiveNote(nextPath);
      requestAnimationFrame(() => {
        scrollIntoViewIfNeeded(
          notesPanelRef.current,
          `[data-note="${escapeSelectorValue(nextPath)}"]`
        );
      });
    },
    [activeNote, foldersPanelRef, lastSelectedNote, notes, notesPanelRef, setActiveNote, setLastSelectedNote, setSelectedNotes]
  );

  // -- Folders keyboard handler
  const handleFoldersKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "ArrowRight") {
        event.preventDefault();
        if (appMode === "notes" && shouldNestNotesInNavigation) {
          const editorElement =
            rightPaneRef.current?.querySelector<HTMLElement>(
              ".tiptap-content[contenteditable='true']"
            ) || rightPaneRef.current;
          focusNoScroll(editorElement);
        } else {
          lastLeftPaneFocusRef.current = "middle";
          focusNoScroll(middlePaneRef.current);
        }
        return;
      }
      if (
        event.key !== "ArrowUp" &&
        event.key !== "ArrowDown" &&
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight"
      )
        return;
      if (activeNavigationTab === "feed") {
        handleFeedKeyboardNavigation(event);
        return;
      }

      if (shouldNestNotesInNavigation) {
        if (visibleNavigationItems.length === 0) return;
        event.preventDefault();

        const navIds = visibleNavigationItems.map((item) => item.id);
        const current =
          lastSelectedNote && navIds.includes(lastSelectedNote)
            ? lastSelectedNote
            : lastSelectedFolder && navIds.includes(lastSelectedFolder)
              ? lastSelectedFolder
              : activeNote && navIds.includes(activeNote)
                ? activeNote
                : activeFolder && navIds.includes(activeFolder)
                  ? activeFolder
                  : navIds[0];
        const currentIndex = navIds.indexOf(current);
        const currentEntry = visibleNavigationItems[currentIndex];
        if (!currentEntry) return;

        const selectFolder = (folderPath: string) => {
          setSelectedFolders(new Set([folderPath]));
          setLastSelectedFolder(folderPath);
          setActiveFolder(folderPath);
          setSelectedNotes(new Set());
          setLastSelectedNote("");
          setActiveNote(null);
          focusNoScroll(foldersPanelRef.current);
          requestAnimationFrame(() => {
            scrollIntoViewIfNeeded(
              foldersPanelRef.current,
              `[data-folder="${escapeSelectorValue(folderPath)}"]`
            );
          });
        };

        const selectNote = (notePath: string, parentPath: string) => {
          setSelectedFolders(new Set(parentPath ? [parentPath] : []));
          setLastSelectedFolder(parentPath);
          setActiveFolder(parentPath);
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
            Math.min(visibleNavigationItems.length - 1, currentIndex + delta)
          );
          const nextEntry = visibleNavigationItems[nextIndex];
          if (!nextEntry) return;
          if (nextEntry.type === "folder") {
            selectFolder(nextEntry.id);
            return;
          }
          selectNote(nextEntry.id, nextEntry.parentId);
          return;
        }

        if (event.key === "ArrowRight") {
          if (currentEntry.type !== "folder") return;
          const folderItem = flatItemById.get(currentEntry.id);
          const noteCount = folderItem?.notes?.length || 0;
          const childCount = folderItem?.children.length || 0;
          const hasNestedItems = childCount > 0 || noteCount > 0;
          if (!hasNestedItems) return;
          if (!expanded.has(currentEntry.id)) {
            setExpanded((prev) => {
              const next = new Set(prev);
              next.add(currentEntry.id);
              return next;
            });
            return;
          }
          const firstChildEntry = visibleNavigationItems[currentIndex + 1];
          if (!firstChildEntry || firstChildEntry.parentId !== currentEntry.id) return;
          if (firstChildEntry.type === "folder") {
            selectFolder(firstChildEntry.id);
            return;
          }
          selectNote(firstChildEntry.id, firstChildEntry.parentId);
          return;
        }

        if (event.key === "ArrowLeft") {
          if (currentEntry.type === "note") {
            selectFolder(currentEntry.parentId);
            return;
          }

          const folderItem = flatItemById.get(currentEntry.id);
          const noteCount = folderItem?.notes?.length || 0;
          const childCount = folderItem?.children.length || 0;
          const hasNestedItems = childCount > 0 || noteCount > 0;
          if (hasNestedItems && expanded.has(currentEntry.id)) {
            setExpanded((prev) => {
              const next = new Set(prev);
              next.delete(currentEntry.id);
              return next;
            });
            return;
          }
          const parentFolderId = currentEntry.parentId;
          if (!parentFolderId) return;
          setExpanded((prev) => {
            const next = new Set(prev);
            next.delete(parentFolderId);
            return next;
          });
          selectFolder(parentFolderId);
        }
        return;
      }

      if (visibleItems.length === 0) return;
      event.preventDefault();

      const current =
        lastSelectedFolder && orderedIds.includes(lastSelectedFolder)
          ? lastSelectedFolder
          : activeFolder || orderedIds[0];
      const currentIndex = orderedIds.indexOf(current);
      const currentItem = visibleItems.find((item) => item.id === current);
      const parentId = currentItem?.parentId ?? null;
      const hasChildren = currentItem ? currentItem.children.length > 0 : false;
      const isExpanded = current ? expanded.has(current) : false;

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const delta = event.key === "ArrowUp" ? -1 : 1;
        const nextIndex = Math.max(
          0,
          Math.min(orderedIds.length - 1, currentIndex + delta)
        );
        const nextPath = orderedIds[nextIndex];
        setSelectedFolders(new Set([nextPath]));
        setLastSelectedFolder(nextPath);
        setActiveFolder(nextPath);
        setSelectedNotes(new Set());
        setLastSelectedNote("");
        setActiveNote(null);
        requestAnimationFrame(() => {
          scrollIntoViewIfNeeded(
            foldersPanelRef.current,
            `[data-folder="${escapeSelectorValue(nextPath)}"]`
          );
        });
        return;
      }

      if (event.key === "ArrowRight") {
        if (currentItem && hasChildren) {
          if (!isExpanded) {
            setExpanded((prev) => {
              const next = new Set(prev);
              next.add(currentItem.id);
              return next;
            });
            return;
          }
          const firstChild = currentItem.children[0];
          if (firstChild) {
            setSelectedFolders(new Set([firstChild.id]));
            setLastSelectedFolder(firstChild.id);
            setActiveFolder(firstChild.id);
            setSelectedNotes(new Set());
            setLastSelectedNote("");
            setActiveNote(null);
            requestAnimationFrame(() => {
              scrollIntoViewIfNeeded(
                foldersPanelRef.current,
                `[data-folder="${escapeSelectorValue(firstChild.id)}"]`
              );
            });
          }
        }
        return;
      }

      if (event.key === "ArrowLeft") {
        if (currentItem && hasChildren && isExpanded) {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.delete(currentItem.id);
            return next;
          });
          return;
        }
        if (parentId) {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.delete(parentId);
            return next;
          });
          setSelectedFolders(new Set([parentId]));
          setLastSelectedFolder(parentId);
          setActiveFolder(parentId);
          setSelectedNotes(new Set());
          setLastSelectedNote("");
          setActiveNote(null);
          requestAnimationFrame(() => {
            scrollIntoViewIfNeeded(
              foldersPanelRef.current,
              `[data-folder="${escapeSelectorValue(parentId)}"]`
            );
          });
        }
      }
    },
    [
      activeFolder,
      activeNote,
      activeFeedGroup,
      activeNavigationTab,
      appMode,
      expanded,
      flatItemById,
      feedNodeById,
      feedVisibleNavigationItems,
      foldersPanelRef,
      lastSelectedFolder,
      lastSelectedNote,
      middlePaneRef,
      orderedIds,
      rightPaneRef,
      setActiveFolder,
      setActiveNote,
      setActiveFeedGroup,
      setExpanded,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
      shouldNestNotesInNavigation,
      visibleItems,
      visibleNavigationItems,
      handleFeedKeyboardNavigation,
    ]
  );

  return {
    handleNotesKeyDown,
    handleFoldersKeyDown,
    lastLeftPaneFocusRef,
  };
}
