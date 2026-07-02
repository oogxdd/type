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

import type { DesktopContextMenuState } from "@/app/hooks/use-tree-interactions";
import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";
import { computeRangeSelection } from "@/shared/lib/selection";
import type { NotePreview } from "@typenotes/shared/format";
import type { AppMode, NoteEntry } from "@typenotes/shared/types";
import type { FeedTreeNode } from "@/features/notes/navigation/model/feed-tree-model";

type FolderSummary = {
  id: string;
};

type UseDesktopNavigationArgs = {
  onAppModeChange: Dispatch<SetStateAction<AppMode>>;
  onOpenPinnedFolder: (path: string) => void;
  customFoldersTreeData: FolderSummary[];
  activeFolder: string;
  activeNote: string | null;
  activeFeedGroup: string;
  activeFeedNode: FeedTreeNode | null;
  feedNotes: Array<NoteEntry & { timestampMs: number }>;
  selectedNotes: Set<string>;
  lastSelectedNote: string;
  setSelectedFolders: Dispatch<SetStateAction<Set<string>>>;
  setLastSelectedFolder: (path: string) => void;
  setActiveFolder: (path: string) => void;
  setSelectedNotes: Dispatch<SetStateAction<Set<string>>>;
  setLastSelectedNote: (path: string) => void;
  setActiveNote: (path: string | null) => void;
  setActiveFeedGroup: (path: string) => void;
  clearNote: () => void;
  openDesktopContextMenu: (state: DesktopContextMenuState) => void;
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
  notes: NoteEntry[];
  notePreviews: Record<string, NotePreview>;
  activeNode: { name: string } | null;
  feedNotePreviews: Record<string, NotePreview>;
  deleteNotes: (paths: string[]) => Promise<boolean>;
};

export function useDesktopNavigation({
  onAppModeChange,
  onOpenPinnedFolder,
  customFoldersTreeData,
  activeFolder,
  activeNote,
  activeFeedGroup,
  activeFeedNode,
  feedNotes,
  selectedNotes,
  lastSelectedNote,
  setSelectedFolders,
  setLastSelectedFolder,
  setActiveFolder,
  setSelectedNotes,
  setLastSelectedNote,
  setActiveNote,
  setActiveFeedGroup,
  clearNote,
  openDesktopContextMenu,
  closeDesktopContextMenu,
  handleNoteClick,
  handleNoteContextMenu,
  notes,
  notePreviews,
  activeNode,
  feedNotePreviews,
  deleteNotes,
}: UseDesktopNavigationArgs) {
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
  }, [activeNote, deleteNotes]);

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
    setSelectedFolders(new Set());
    setLastSelectedFolder("");
    setSelectedNotes(new Set());
    setLastSelectedNote("");
    setActiveFolder("");
    setActiveNote(null);
    clearNote();
  }, [
    clearNote,
    closeDesktopContextMenu,
    customFoldersTreeData,
    onAppModeChange,
    onOpenPinnedFolder,
    setActiveFolder,
    setActiveNote,
    setLastSelectedFolder,
    setLastSelectedNote,
    setSelectedFolders,
    setSelectedNotes,
  ]);

  const handleFeedMiddleNoteClick = useCallback(
    (notePath: string, event: ReactMouseEvent) => {
      const notePaths = feedNotes.map((note) => note.path);
      setSelectedNotes(
        computeRangeSelection(event, selectedNotes, notePaths, lastSelectedNote, notePath)
      );
      setLastSelectedNote(notePath);
      setSelectedFolders(new Set([FEED_FOLDER_PATH]));
      setLastSelectedFolder(FEED_FOLDER_PATH);
      setActiveFolder(FEED_FOLDER_PATH);
      setActiveNote(notePath);
      setActiveFeedGroup(activeFeedGroup || activeFeedNode?.id || "");
      setActiveNavigationTab("feed");
    },
    [
      activeFeedGroup,
      activeFeedNode?.id,
      feedNotes,
      lastSelectedNote,
      setActiveFeedGroup,
      setActiveFolder,
      setActiveNote,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
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
      setActiveFeedGroup,
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
