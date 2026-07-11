import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";
import { useShallow } from "zustand/react/shallow";

import type { ContextMenuState } from "./use-tree-interactions";
import { useSelection } from "@/state/selection-store";
import { clearNote } from "@/state/editor-store";
import { deleteNotes } from "@/state/notes-actions";
import {
  selectTreeData,
  setActiveFeedGroup,
  useActiveFeedGroup,
  useActiveFeedNode,
  useActiveFolderNotes,
  useActiveNode,
  useActiveNotePreviews,
  useFeedNotePreviews,
  useFeedNotes,
  useNotesStore,
} from "@/state/notes-store";
import { FEED_FOLDER_PATH, isSystemFolder } from "@typenotes/shared/constants";
import { computeRangeSelection } from "@/lib/selection";
import type { AppMode } from "@typenotes/shared/types";

type UseNavigationTabsArgs = {
  onAppModeChange: Dispatch<SetStateAction<AppMode>>;
  onOpenPinnedFolder: (path: string) => void;
  openDesktopContextMenu: (state: ContextMenuState) => void;
  closeDesktopContextMenu: () => void;
  handleNoteClick: (
    notePath: string,
    event: ReactMouseEvent,
    parentPath?: string
  ) => void;
  handleNoteContextMenu: (
    event: ReactMouseEvent,
    notePath: string,
    parentPath?: string
  ) => Promise<void>;
};

export function useNavigationTabs({
  onAppModeChange,
  onOpenPinnedFolder,
  openDesktopContextMenu,
  closeDesktopContextMenu,
  handleNoteClick,
  handleNoteContextMenu,
}: UseNavigationTabsArgs) {
  const treeData = useNotesStore(selectTreeData);
  const notes = useActiveFolderNotes();
  const notePreviews = useActiveNotePreviews();
  const activeNode = useActiveNode();
  const activeFeedGroup = useActiveFeedGroup();
  const activeFeedNode = useActiveFeedNode();
  const feedNotes = useFeedNotes();
  const feedNotePreviews = useFeedNotePreviews();
  const {
    activeFolder,
    activeNote,
    selectedNotes,
    lastSelectedNote,
    selectNote,
    resetSelection,
    setSelectedFolders,
    setLastSelectedFolder,
    setActiveFolder,
    setSelectedNotes,
    setLastSelectedNote,
    setActiveNote,
  } = useSelection(
    useShallow((state) => ({
      activeFolder: state.activeFolder,
      activeNote: state.activeNote,
      selectedNotes: state.selectedNotes,
      lastSelectedNote: state.lastSelectedNote,
      selectNote: state.selectNote,
      resetSelection: state.resetSelection,
      setSelectedFolders: state.setSelectedFolders,
      setLastSelectedFolder: state.setLastSelectedFolder,
      setActiveFolder: state.setActiveFolder,
      setSelectedNotes: state.setSelectedNotes,
      setLastSelectedNote: state.setLastSelectedNote,
      setActiveNote: state.setActiveNote,
    }))
  );

  const customFoldersTreeData = useMemo(
    () => treeData.filter((node) => !isSystemFolder(node.id)),
    [treeData]
  );

  const [activeNavigationTab, setActiveNavigationTab] = useState<"feed" | "folders">(
    "folders"
  );
  // Feed is a transient view. Remember the last real folder so "back to folders"
  // has a stable place to land instead of guessing from the current tree.
  const lastNonFeedFolderRef = useRef<string>("");
  const selectedNotesRef = useRef<Set<string>>(new Set());
  selectedNotesRef.current = selectedNotes;

  useEffect(() => {
    if (activeFolder && activeFolder !== FEED_FOLDER_PATH) {
      lastNonFeedFolderRef.current = activeFolder;
    }
  }, [activeFolder]);

  useEffect(() => {
    if (activeFolder === FEED_FOLDER_PATH && activeNavigationTab !== "feed") {
      setActiveNavigationTab("feed");
      return;
    }
    if (activeFolder !== FEED_FOLDER_PATH && activeNavigationTab === "feed") {
      setActiveNavigationTab("folders");
    }
  }, [activeFolder, activeNavigationTab]);

  const deleteSelectedNotesByShortcut = useCallback(() => {
    const selected = selectedNotesRef.current;
    const paths =
      activeNote && !selected.has(activeNote)
        ? [activeNote]
        : selected.size > 0
          ? Array.from(selected)
          : activeNote
            ? [activeNote]
            : [];
    if (paths.length > 0) {
      void deleteNotes(paths);
    }
  }, [activeNote]);

  const openFeedTab = useCallback(() => {
    closeDesktopContextMenu();
    onAppModeChange("notes");
    if (activeFolder && activeFolder !== FEED_FOLDER_PATH) {
      lastNonFeedFolderRef.current = activeFolder;
    }
    setActiveNavigationTab("feed");
    onOpenPinnedFolder(FEED_FOLDER_PATH);
  }, [activeFolder, closeDesktopContextMenu, onAppModeChange, onOpenPinnedFolder]);

  const openFoldersTab = useCallback(() => {
    closeDesktopContextMenu();
    onAppModeChange("notes");
    setActiveNavigationTab("folders");
    const fallbackFolder =
      lastNonFeedFolderRef.current || customFoldersTreeData[0]?.id || "";
    if (fallbackFolder) {
      onOpenPinnedFolder(fallbackFolder);
      return;
    }
    resetSelection();
    clearNote();
  }, [
    clearNote,
    closeDesktopContextMenu,
    customFoldersTreeData,
    onAppModeChange,
    onOpenPinnedFolder,
    resetSelection,
  ]);

  const handleFeedMiddleNoteClick = useCallback(
    (notePath: string, event: ReactMouseEvent) => {
      const notePaths = feedNotes.map((note) => note.path);
      selectNote(
        notePath,
        FEED_FOLDER_PATH,
        computeRangeSelection(event, selectedNotes, notePaths, lastSelectedNote, notePath)
      );
      setActiveFeedGroup(activeFeedGroup || activeFeedNode?.id || "");
      setActiveNavigationTab("feed");
    },
    [
      activeFeedGroup,
      activeFeedNode?.id,
      feedNotes,
      lastSelectedNote,
      selectNote,
      selectedNotes,
    ]
  );

  const handleFeedMiddleNoteContextMenu = useCallback(
    (event: ReactMouseEvent, notePath: string) => {
      event.preventDefault();
      event.stopPropagation();
      const notePaths = feedNotes.map((note) => note.path);
      const targetPaths =
        selectedNotes.size > 1 && selectedNotes.has(notePath)
          ? Array.from(selectedNotes)
          : [notePath];
      setSelectedFolders(new Set([FEED_FOLDER_PATH]));
      setLastSelectedFolder(FEED_FOLDER_PATH);
      setActiveFolder(FEED_FOLDER_PATH);
      // Keeps the existing multi-selection (and its range anchor) when the
      // target note is already part of it.
      if (!selectedNotes.has(notePath)) {
        setSelectedNotes(new Set([notePath]));
        setLastSelectedNote(notePath);
      }
      setActiveNote(notePath);
      setActiveFeedGroup(activeFeedGroup || activeFeedNode?.id || "");
      setActiveNavigationTab("feed");
      openDesktopContextMenu({
        kind: "note",
        x: event.clientX,
        y: event.clientY,
        path: notePath,
        parentPath: activeFeedGroup || activeFeedNode?.id || FEED_FOLDER_PATH,
        targetPaths: targetPaths.length > 0 ? targetPaths : notePaths,
      });
    },
    [
      activeFeedGroup,
      activeFeedNode?.id,
      feedNotes,
      openDesktopContextMenu,
      selectedNotes,
      setActiveFolder,
      setActiveNote,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
    ]
  );

  // The middle pane mirrors whichever list is active in the desktop tabs.
  const middlePaneNotes = useMemo(
    () => (activeNavigationTab === "feed" ? feedNotes : notes),
    [activeNavigationTab, feedNotes, notes]
  );
  const middlePaneNotePreviews = useMemo(
    () => (activeNavigationTab === "feed" ? feedNotePreviews : notePreviews),
    [activeNavigationTab, feedNotePreviews, notePreviews]
  );
  const middlePaneTitle = useMemo(
    () =>
      activeNavigationTab === "feed"
        ? activeFeedNode?.name || "Feed"
        : activeNode?.name || activeFolder || "Notes",
    [activeFeedNode?.name, activeFolder, activeNavigationTab, activeNode?.name]
  );
  // Feed needs to rewrite selection into its own group; folder notes can use the
  // tree interaction handlers directly.
  const middlePaneNoteClick = useCallback(
    (notePath: string, event: ReactMouseEvent, parentPath?: string) => {
      if (activeNavigationTab === "feed") {
        handleFeedMiddleNoteClick(notePath, event);
        return;
      }
      handleNoteClick(notePath, event, parentPath);
    },
    [activeNavigationTab, handleFeedMiddleNoteClick, handleNoteClick]
  );
  const middlePaneNoteContextMenu = useCallback(
    async (event: ReactMouseEvent, notePath: string, parentPath?: string) => {
      if (activeNavigationTab === "feed") {
        handleFeedMiddleNoteContextMenu(event, notePath);
        return;
      }
      await handleNoteContextMenu(event, notePath, parentPath);
    },
    [activeNavigationTab, handleFeedMiddleNoteContextMenu, handleNoteContextMenu]
  );

  return {
    activeNavigationTab,
    customFoldersTreeData,
    deleteSelectedNotesByShortcut,
    openFeedTab,
    openFoldersTab,
    middlePaneNotes,
    middlePaneNotePreviews,
    middlePaneTitle,
    middlePaneNoteClick,
    middlePaneNoteContextMenu,
  };
}
