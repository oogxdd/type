import { useCallback, useEffect, useRef } from "react";
import type { AppMode, PaneId, VisibleNavigationItem } from "@/types";
import type { FlattenedItem } from "./types";
import { focusNoScroll, scrollIntoViewIfNeeded, escapeSelectorValue } from "@/utils/dom";

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
  activeNode: { path: string } | null;
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
  activeNode,
  foldersPanelRef,
  middlePaneRef,
  rightPaneRef,
  notesPanelRef,
}: UseKeyboardNavigationArgs) {
  const lastLeftPaneFocusRef = useRef<"folders" | "middle">("middle");

  // -- Global keyboard shortcuts
  useEffect(() => {
    if (layoutMode !== "desktop") {
      return;
    }
    const hasMiddlePane = appMode !== "notes" || !shouldNestNotesInNavigation;

    const getFocusedPane = (): PaneId | null => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (!activeElement) return null;
      if (
        foldersPanelRef.current &&
        (activeElement === foldersPanelRef.current ||
          foldersPanelRef.current.contains(activeElement))
      )
        return "folders";
      if (
        middlePaneRef.current &&
        (activeElement === middlePaneRef.current ||
          middlePaneRef.current.contains(activeElement))
      )
        return "middle";
      if (
        rightPaneRef.current &&
        (activeElement === rightPaneRef.current ||
          rightPaneRef.current.contains(activeElement))
      )
        return "right";
      return null;
    };

    const focusPane = (pane: PaneId) => {
      if (pane === "folders") {
        focusNoScroll(foldersPanelRef.current);
        return;
      }
      if (pane === "middle") {
        if (!hasMiddlePane) {
          focusNoScroll(foldersPanelRef.current);
          return;
        }
        focusNoScroll(middlePaneRef.current);
        return;
      }
      const editorElement =
        appMode === "notes"
          ? rightPaneRef.current?.querySelector<HTMLElement>(
              ".tiptap-content[contenteditable='true']"
            ) || rightPaneRef.current
          : rightPaneRef.current;
      focusNoScroll(editorElement);
    };

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.repeat) return;
      const code = event.code;
      const isLockShortcut = code === "KeyL" && event.shiftKey;
      if (
        code !== "KeyT" &&
        code !== "KeyW" &&
        code !== "KeyK" &&
        code !== "KeyJ" &&
        code !== "KeyN" &&
        code !== "Backspace" &&
        code !== "Equal" &&
        code !== "Minus" &&
        code !== "Digit0" &&
        code !== "NumpadAdd" &&
        code !== "NumpadSubtract" &&
        code !== "Numpad0" &&
        !isLockShortcut
      )
        return;
      event.preventDefault();

      if (code === "Equal" || code === "NumpadAdd") {
        if (appMode === "notes") increaseEditorFontSize();
        return;
      }
      if (code === "Minus" || code === "NumpadSubtract") {
        if (appMode === "notes") decreaseEditorFontSize();
        return;
      }
      if (code === "Digit0" || code === "Numpad0") {
        if (appMode === "notes") resetEditorFontSize();
        return;
      }
      if (code === "KeyN") {
        void createNewNote();
        return;
      }
      if (isLockShortcut) {
        void lockAppNow();
        return;
      }
      if (code === "Backspace") {
        if (appMode === "notes") deleteSelectedNotes();
        return;
      }
      if (code === "KeyT") {
        const currentPane = getFocusedPane();
        setSidebarCollapsed((prev) => {
          const next = !prev;
          if (next) {
            if (currentPane === "folders" || currentPane === "middle")
              lastLeftPaneFocusRef.current = currentPane;
            requestAnimationFrame(() => focusPane("right"));
          } else {
            requestAnimationFrame(() => focusPane(lastLeftPaneFocusRef.current));
          }
          return next;
        });
        return;
      }
      if (code === "KeyW") {
        if (sidebarCollapsed) {
          setSidebarCollapsed(false);
          requestAnimationFrame(() =>
            focusPane(hasMiddlePane ? lastLeftPaneFocusRef.current : "folders")
          );
          return;
        }
        if (!hasMiddlePane) {
          lastLeftPaneFocusRef.current = "folders";
          focusPane("folders");
          return;
        }
        const currentPane = getFocusedPane();
        const targetPane: "folders" | "middle" =
          currentPane === "folders" ? "middle" : "folders";
        lastLeftPaneFocusRef.current = targetPane;
        focusPane(targetPane);
        return;
      }

      const panes: PaneId[] = sidebarCollapsed
        ? ["right"]
        : hasMiddlePane
          ? ["folders", "middle", "right"]
          : ["folders", "right"];
      const currentPane = getFocusedPane();
      const startPane =
        currentPane && panes.includes(currentPane)
          ? currentPane
          : hasMiddlePane
            ? "middle"
            : "folders";
      const delta = code === "KeyK" ? 1 : -1;
      const nextIndex = Math.max(
        0,
        Math.min(panes.length - 1, panes.indexOf(startPane) + delta)
      );
      const targetPane = panes[nextIndex];
      if (targetPane === "folders" || targetPane === "middle")
        lastLeftPaneFocusRef.current = targetPane;
      focusPane(targetPane);
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [
    appMode,
    createNewNote,
    deleteSelectedNotes,
    decreaseEditorFontSize,
    foldersPanelRef,
    increaseEditorFontSize,
    layoutMode,
    middlePaneRef,
    resetEditorFontSize,
    rightPaneRef,
    lockAppNow,
    setSidebarCollapsed,
    shouldNestNotesInNavigation,
    sidebarCollapsed,
  ]);

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
      if (!activeNode || notes.length === 0) return;
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
    [activeNode, activeNote, foldersPanelRef, lastSelectedNote, notes, notesPanelRef, setActiveNote, setLastSelectedNote, setSelectedNotes]
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
      appMode,
      expanded,
      flatItemById,
      foldersPanelRef,
      lastSelectedFolder,
      lastSelectedNote,
      middlePaneRef,
      orderedIds,
      rightPaneRef,
      setActiveFolder,
      setActiveNote,
      setExpanded,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
      shouldNestNotesInNavigation,
      visibleItems,
      visibleNavigationItems,
    ]
  );

  return {
    handleNotesKeyDown,
    handleFoldersKeyDown,
    lastLeftPaneFocusRef,
  };
}
