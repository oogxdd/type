import { useCallback, useRef } from "react";

import type { AppMode } from "@typenotes/shared/types";
import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";
import {
  selectFolder,
  selectNote,
  setActiveNote,
  setLastSelectedNote,
  setSelectedNotes,
  useSelection,
} from "@/state/selection-store";
import { clearDraft, clearNote, rightPaneRef } from "@/state/editor-store";
import {
  selectFlatItemById,
  setActiveFeedGroup,
  setExpanded,
  useActiveFeedGroup,
  useFeedTree,
  useFeedVisibleNavigationItems,
  useNotesStore,
  useShouldNestNotesInNavigation,
  useVisibleNavigationItems,
} from "@/state/notes-store";
import { focusNoScroll, scrollIntoViewIfNeeded, escapeSelectorValue } from "@/lib/dom";
import { usePaneShortcuts } from "./use-pane-shortcuts";
import {
  navigateVisibleItems,
  type NavigationKey,
} from "@/lib/notes/visible-navigation";

type UseKeyboardNavigationArgs = {
  appMode: AppMode;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  deleteSelectedNotes: () => void;
  lockAppNow: () => Promise<void>;
  activeNavigationTab: "feed" | "folders";
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
  notes,
  foldersPanelRef,
  middlePaneRef,
  notesPanelRef,
}: UseKeyboardNavigationArgs) {
  const flatItemById = useNotesStore(selectFlatItemById);
  const expanded = useNotesStore((state) => state.expanded);
  const visibleNavigationItems = useVisibleNavigationItems();
  const feedVisibleNavigationItems = useFeedVisibleNavigationItems();
  const { nodeById: feedNodeById } = useFeedTree();
  const activeFeedGroup = useActiveFeedGroup();
  const shouldNestNotesInNavigation = useShouldNestNotesInNavigation();
  const activeFolder = useSelection((state) => state.activeFolder);
  const lastSelectedFolder = useSelection((state) => state.lastSelectedFolder);
  const activeNote = useSelection((state) => state.activeNote);
  const lastSelectedNote = useSelection((state) => state.lastSelectedNote);

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

      const isFeed = activeNavigationTab === "feed";
      const items = isFeed ? feedVisibleNavigationItems : visibleNavigationItems;
      if (items.length === 0) return;
      event.preventDefault();

      const focusPanel = () => focusNoScroll(foldersPanelRef.current);
      const scrollRowIntoView = (attribute: "data-folder" | "data-note", id: string) => {
        requestAnimationFrame(() => {
          scrollIntoViewIfNeeded(
            foldersPanelRef.current,
            `[${attribute}="${escapeSelectorValue(id)}"]`
          );
        });
      };

      navigateVisibleItems(event.key as NavigationKey, {
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
        expand: (id) =>
          setExpanded((prev) => {
            const next = new Set(prev);
            next.add(id);
            return next;
          }),
        collapse: (id) =>
          setExpanded((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          }),
        selectFolder: (id) => {
          if (isFeed) {
            setActiveFeedGroup(id);
            selectFolder(FEED_FOLDER_PATH);
          } else {
            selectFolder(id);
          }
          clearDraft();
          clearNote();
          focusPanel();
          scrollRowIntoView("data-folder", id);
        },
        selectNote: (id, parentId) => {
          if (isFeed) {
            setActiveFeedGroup(parentId);
            selectNote(id, FEED_FOLDER_PATH);
          } else {
            selectNote(id, parentId);
          }
          focusPanel();
          scrollRowIntoView("data-note", id);
        },
      });
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
      selectFolder,
      selectNote,
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
