import { useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import type { AppMode } from "@typenotes/shared/types";
import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";
import { useSelection } from "@/app/state/selection-store";
import { useEditor } from "@/features/notes/editor/hooks/editor-context";
import { useNotesTree } from "@/features/notes/navigation/state/notes-tree-context";
import { focusNoScroll, scrollIntoViewIfNeeded, escapeSelectorValue } from "@/shared/lib/dom";
import { usePaneShortcuts } from "./use-pane-shortcuts";
import {
  navigateVisibleItems,
  type NavigationKey,
} from "../model/visible-navigation";

type UseKeyboardNavigationArgs = {
  appMode: AppMode;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  deleteSelectedNotes: () => void;
  lockAppNow: () => Promise<void>;
  activeNavigationTab: "feed" | "folders";
  openFeedTab: () => void;
  openFoldersTab: () => void;
  /** The middle-pane note list the notes-pane arrow handler walks. */
  notes: Array<{ path: string }>;
  foldersPanelRef: React.RefObject<HTMLDivElement | null>;
  middlePaneRef: React.RefObject<HTMLDivElement | null>;
  notesPanelRef: React.RefObject<HTMLDivElement | null>;
};

export function useKeyboardNavigation({
  appMode,
  sidebarCollapsed,
  setSidebarCollapsed,
  deleteSelectedNotes,
  lockAppNow,
  activeNavigationTab,
  openFeedTab,
  openFoldersTab,
  notes,
  foldersPanelRef,
  middlePaneRef,
  notesPanelRef,
}: UseKeyboardNavigationArgs) {
  const { clearDraft, clearNote, rightPaneRef } = useEditor();
  const {
    flatItemById,
    expanded,
    setExpanded,
    visibleNavigationItems,
    feedVisibleNavigationItems,
    feedNodeById,
    activeFeedGroup,
    setActiveFeedGroup,
    shouldNestNotesInNavigation,
  } = useNotesTree();
  const {
    activeFolder,
    lastSelectedFolder,
    activeNote,
    lastSelectedNote,
    selectFolder: selectFolderState,
    selectNote: selectNoteState,
    setSelectedNotes,
    setLastSelectedNote,
    setActiveNote,
  } = useSelection(
    useShallow((state) => ({
      activeFolder: state.activeFolder,
      lastSelectedFolder: state.lastSelectedFolder,
      activeNote: state.activeNote,
      lastSelectedNote: state.lastSelectedNote,
      selectFolder: state.selectFolder,
      selectNote: state.selectNote,
      setSelectedNotes: state.setSelectedNotes,
      setLastSelectedNote: state.setLastSelectedNote,
      setActiveNote: state.setActiveNote,
    }))
  );

  const lastLeftPaneFocusRef = useRef<"folders" | "middle">("middle");

  usePaneShortcuts({
    appMode,
    sidebarCollapsed,
    setSidebarCollapsed,
    deleteSelectedNotes,
    lockAppNow,
    foldersPanelRef,
    middlePaneRef,
    lastLeftPaneFocusRef,
  });

  // -- Notes list keyboard handler. Moves within the middle-pane list only, so
  // it deliberately leaves the folder selection untouched.
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

  // -- Folders/Feed pane keyboard handler. Both tabs walk the same flat
  // visible-rows list; only where a "folder" selection lands differs (a real
  // folder vs. the Feed pseudo-folder plus a feed group).
  const handleFoldersKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }

      if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        if (activeNavigationTab === "feed") {
          openFoldersTab();
        } else {
          openFeedTab();
        }
        requestAnimationFrame(() => focusNoScroll(foldersPanelRef.current));
        return;
      }

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
      const code = event.code;
      const isPlainKey = !event.metaKey && !event.ctrlKey && !event.altKey;
      const navigationKey: NavigationKey | null =
        event.key === "ArrowUp" || (isPlainKey && code === "KeyK")
          ? "ArrowUp"
          : event.key === "ArrowDown" || (isPlainKey && code === "KeyJ")
            ? "ArrowDown"
            : event.key === "ArrowLeft"
              ? "ArrowLeft"
              : event.key === "ArrowRight"
                ? "ArrowRight"
                : null;
      const isVimCollapse = isPlainKey && code === "KeyH";
      const isVimExpand = isPlainKey && code === "KeyL";
      const isEnter = isPlainKey && event.key === "Enter";
      if (!navigationKey && !isVimCollapse && !isVimExpand && !isEnter) return;

      const isFeed = activeNavigationTab === "feed";
      const items = isFeed ? feedVisibleNavigationItems : visibleNavigationItems;
      if (items.length === 0) return;
      event.preventDefault();

      const itemIds = items.map((item) => item.id);
      const currentId = [
        lastSelectedNote,
        lastSelectedFolder,
        activeNote,
        isFeed ? activeFeedGroup : activeFolder,
      ].find((id) => Boolean(id && itemIds.includes(id))) ?? itemIds[0];
      const currentItem = items.find((item) => item.id === currentId);

      const focusPanel = () => focusNoScroll(foldersPanelRef.current);
      const focusEditor = () => {
        const editorElement =
          rightPaneRef.current?.querySelector<HTMLElement>(
            ".tiptap-content[contenteditable='true']"
          ) || rightPaneRef.current;
        focusNoScroll(editorElement);
      };
      const scrollRowIntoView = (attribute: "data-folder" | "data-note", id: string) => {
        requestAnimationFrame(() => {
          scrollIntoViewIfNeeded(
            foldersPanelRef.current,
            `[${attribute}="${escapeSelectorValue(id)}"]`
          );
        });
      };

      const selectFolder = (id: string) => {
        if (isFeed) {
          setActiveFeedGroup(id);
          selectFolderState(FEED_FOLDER_PATH);
        } else {
          selectFolderState(id);
        }
        clearDraft();
        clearNote();
        focusPanel();
        scrollRowIntoView("data-folder", id);
      };
      const selectNote = (id: string, parentId: string) => {
        if (isFeed) {
          setActiveFeedGroup(parentId);
          selectNoteState(id, FEED_FOLDER_PATH);
        } else {
          selectNoteState(id, parentId);
        }
        focusPanel();
        scrollRowIntoView("data-note", id);
      };
      const expandFolder = (id: string) =>
        setExpanded((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      const collapseFolder = (id: string) =>
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });

      if (isEnter && currentItem) {
        if (currentItem.type === "note") {
          focusEditor();
          return;
        }
        if (expanded.has(currentItem.id)) {
          collapseFolder(currentItem.id);
        } else {
          expandFolder(currentItem.id);
        }
        return;
      }

      if ((isVimCollapse || isVimExpand) && currentItem) {
        const folderId =
          currentItem.type === "folder" ? currentItem.id : currentItem.parentId;
        if (isVimCollapse) {
          collapseFolder(folderId);
          if (currentItem.type === "note") {
            selectFolder(folderId);
          }
        } else {
          expandFolder(folderId);
        }
        return;
      }

      if (!navigationKey) return;
      navigateVisibleItems(navigationKey, {
        items,
        preferredIds: [
          lastSelectedNote,
          lastSelectedFolder,
          activeNote,
          isFeed ? activeFeedGroup : activeFolder,
        ],
        expanded,
        hasNestedItems: (id) => {
          const node = isFeed ? feedNodeById.get(id) : flatItemById.get(id);
          return (
            (node?.children.length ?? 0) > 0 ||
            (shouldNestNotesInNavigation && (node?.notes?.length ?? 0) > 0)
          );
        },
        expand: expandFolder,
        collapse: collapseFolder,
        selectFolder,
        selectNote,
      });
    },
    [
      activeFolder,
      activeNote,
      activeFeedGroup,
      activeNavigationTab,
      appMode,
      clearDraft,
      clearNote,
      expanded,
      flatItemById,
      feedNodeById,
      feedVisibleNavigationItems,
      foldersPanelRef,
      lastSelectedFolder,
      lastSelectedNote,
      middlePaneRef,
      openFeedTab,
      openFoldersTab,
      rightPaneRef,
      selectFolderState,
      selectNoteState,
      setActiveFeedGroup,
      setExpanded,
      shouldNestNotesInNavigation,
      visibleNavigationItems,
    ]
  );

  return {
    handleNotesKeyDown,
    handleFoldersKeyDown,
    lastLeftPaneFocusRef,
  };
}
