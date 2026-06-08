import {
  useCallback,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu } from "@tauri-apps/api/menu";
import { useShallow } from "zustand/react/shallow";

import { useSelection } from "@/app/state/selection-store";
import { useNotesTree } from "@/features/notes/hooks/notes-tree-context";
import { findNode } from "@/features/tree/lib/tree-ops";
import { focusNoScroll } from "@/shared/lib/dom";
import { getNoteParentPath } from "@/shared/lib/notes";
import { computeRangeSelection, resolveTargetPaths } from "@/shared/lib/selection";

type UseTreeInteractionsArgs = {
  /** The folders pane body; focused after a selection change. */
  foldersPanelRef: RefObject<HTMLDivElement | null>;
  useNativeContextMenus?: boolean;
};

export type DesktopContextMenuState =
  | {
      kind: "folder";
      x: number;
      y: number;
      path: string;
      targetPaths: string[];
    }
  | {
      kind: "note";
      x: number;
      y: number;
      path: string;
      parentPath: string;
      targetPaths: string[];
    };

export type TreeInteractions = {
  handleFolderClick: (event: ReactMouseEvent, path: string) => void;
  handleToggle: (event: ReactMouseEvent, id: string) => void;
  handleNoteClick: (
    notePath: string,
    event: ReactMouseEvent,
    parentPath?: string
  ) => void;
  handleFolderContextMenu: (
    event: ReactMouseEvent,
    path: string
  ) => Promise<void>;
  handleNoteContextMenu: (
    event: ReactMouseEvent,
    path: string,
    parentPath?: string
  ) => Promise<void>;
  desktopContextMenuState: DesktopContextMenuState | null;
  openDesktopContextMenu: (state: DesktopContextMenuState) => void;
  closeDesktopContextMenu: () => void;
};

/**
 * Folder/note interaction handlers shared by the desktop and mobile shells:
 * range-aware click selection, expand/collapse toggling, and the right-click
 * menus used by the tree UI. Desktop can switch to a React/shadcn popup menu;
 * mobile keeps the existing action-sheet / native behavior.
 */
export const useTreeInteractions = ({
  foldersPanelRef,
  useNativeContextMenus = true,
}: UseTreeInteractionsArgs): TreeInteractions => {
  const {
    selectedFolders,
    setSelectedFolders,
    lastSelectedFolder,
    setLastSelectedFolder,
    setActiveFolder,
    selectedNotes,
    setSelectedNotes,
    lastSelectedNote,
    setLastSelectedNote,
    setActiveNote,
  } = useSelection(
    useShallow((state) => ({
      selectedFolders: state.selectedFolders,
      setSelectedFolders: state.setSelectedFolders,
      lastSelectedFolder: state.lastSelectedFolder,
      setLastSelectedFolder: state.setLastSelectedFolder,
      setActiveFolder: state.setActiveFolder,
      selectedNotes: state.selectedNotes,
      setSelectedNotes: state.setSelectedNotes,
      lastSelectedNote: state.lastSelectedNote,
      setLastSelectedNote: state.setLastSelectedNote,
      setActiveNote: state.setActiveNote,
    }))
  );

  const {
    tree,
    orderedIds,
    setExpanded,
    deleteFolders,
    deleteNotes,
    moveNotesToArchive,
    startRenameFolder,
    showNoteInfo,
    shouldNestNotesInNavigation,
  } = useNotesTree();

  // The native menus are created once and reused; the path each acts on is read
  // from a ref set just before popup (menu-item actions can't close over args).
  const folderContextPathRef = useRef<string | null>(null);
  const noteContextPathRef = useRef<string | null>(null);
  const folderMenuPromiseRef = useRef<Promise<Menu> | null>(null);
  const noteMenuPromiseRef = useRef<Promise<Menu> | null>(null);

  // Latest selection, readable from menu-item actions without re-creating menus.
  const selectedFoldersRef = useRef<Set<string>>(new Set());
  const selectedNotesRef = useRef<Set<string>>(new Set());
  selectedFoldersRef.current = selectedFolders;
  selectedNotesRef.current = selectedNotes;

  const [desktopContextMenuState, setDesktopContextMenuState] =
    useState<DesktopContextMenuState | null>(null);

  const openDesktopContextMenu = useCallback(
    (state: DesktopContextMenuState) => {
      setDesktopContextMenuState(state);
    },
    []
  );

  const closeDesktopContextMenu = useCallback(() => {
    setDesktopContextMenuState(null);
  }, []);

  const handleFolderClick = (event: ReactMouseEvent, path: string) => {
    event.stopPropagation();
    setSelectedFolders(
      computeRangeSelection(event, selectedFolders, orderedIds, lastSelectedFolder, path)
    );
    setLastSelectedFolder(path);
    setActiveFolder(path);
    setSelectedNotes(new Set());
    setLastSelectedNote("");
    setActiveNote(null);
    focusNoScroll(foldersPanelRef.current);
  };

  const handleToggle = (event: ReactMouseEvent, id: string) => {
    event.stopPropagation();
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getFolderNativeMenu = () => {
    if (!folderMenuPromiseRef.current) {
      folderMenuPromiseRef.current = Menu.new({
        items: [
          {
            id: "folder.rename",
            text: "Rename folder",
            action: () => {
              const path = folderContextPathRef.current;
              if (path) startRenameFolder(path);
            },
          },
          {
            id: "folder.delete",
            text: "Delete folder",
            action: () => {
              const path = folderContextPathRef.current;
              if (!path) return;
              void deleteFolders(resolveTargetPaths(selectedFoldersRef.current, path));
            },
          },
        ],
      });
    }
    return folderMenuPromiseRef.current;
  };

  const handleFolderContextMenu = async (event: ReactMouseEvent, path: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedFolders.has(path)) {
      setSelectedFolders(new Set([path]));
      setLastSelectedFolder(path);
    }
    setActiveFolder(path);
    setSelectedNotes(new Set());
    setLastSelectedNote("");
    setActiveNote(null);
    focusNoScroll(foldersPanelRef.current);

    if (!useNativeContextMenus) {
      setDesktopContextMenuState({
        kind: "folder",
        x: event.clientX,
        y: event.clientY,
        path,
        targetPaths: selectedFolders.has(path)
          ? resolveTargetPaths(selectedFoldersRef.current, path)
          : [path],
      });
      return;
    }

    folderContextPathRef.current = path;
    const menu = await getFolderNativeMenu();
    await menu.popup(new LogicalPosition(event.clientX, event.clientY));
  };

  const handleNoteClick = (
    notePath: string,
    event: ReactMouseEvent,
    parentPath?: string
  ) => {
    const noteParentPath = parentPath ?? getNoteParentPath(notePath);
    const parentNode = findNode(tree, noteParentPath);
    if (!parentNode) return;
    const notePaths = parentNode.notes.map((n) => n.path);
    setSelectedNotes(
      computeRangeSelection(event, selectedNotes, notePaths, lastSelectedNote, notePath)
    );
    setLastSelectedNote(notePath);
    setSelectedFolders(new Set(noteParentPath ? [noteParentPath] : []));
    setLastSelectedFolder(noteParentPath);
    setActiveFolder(noteParentPath);
    setActiveNote(notePath);
    if (parentPath !== undefined || shouldNestNotesInNavigation) {
      focusNoScroll(foldersPanelRef.current);
    }
  };

  const getNoteNativeMenu = () => {
    if (!noteMenuPromiseRef.current) {
      noteMenuPromiseRef.current = Menu.new({
        items: [
          {
            id: "note.info",
            text: "See info",
            action: () => {
              const path = noteContextPathRef.current;
              if (path) void showNoteInfo(path);
            },
          },
          {
            id: "note.delete",
            text: "Delete selected",
            action: () => {
              const path = noteContextPathRef.current;
              if (!path) return;
              void deleteNotes(resolveTargetPaths(selectedNotesRef.current, path));
            },
          },
          {
            id: "note.move.archieve",
            text: "Move to Archive",
            action: () => {
              const path = noteContextPathRef.current;
              if (!path) return;
              void moveNotesToArchive(resolveTargetPaths(selectedNotesRef.current, path));
            },
          },
        ],
      });
    }
    return noteMenuPromiseRef.current;
  };

  const handleNoteContextMenu = async (
    event: ReactMouseEvent,
    path: string,
    parentPath?: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const noteParentPath = parentPath ?? getNoteParentPath(path);
    setSelectedFolders(new Set(noteParentPath ? [noteParentPath] : []));
    setLastSelectedFolder(noteParentPath);
    setActiveFolder(noteParentPath);
    if (!selectedNotes.has(path)) {
      setSelectedNotes(new Set([path]));
      setLastSelectedNote(path);
    }
    setActiveNote(path);
    if (parentPath !== undefined || shouldNestNotesInNavigation) {
      focusNoScroll(foldersPanelRef.current);
    }

    if (!useNativeContextMenus) {
      setDesktopContextMenuState({
        kind: "note",
        x: event.clientX,
        y: event.clientY,
        path,
        parentPath: noteParentPath,
        targetPaths: selectedNotes.has(path)
          ? resolveTargetPaths(selectedNotesRef.current, path)
          : [path],
      });
      return;
    }

    noteContextPathRef.current = path;
    const menu = await getNoteNativeMenu();
    await menu.popup(new LogicalPosition(event.clientX, event.clientY));
  };

  return {
    handleFolderClick,
    handleToggle,
    handleNoteClick,
    handleFolderContextMenu,
    handleNoteContextMenu,
    desktopContextMenuState,
    openDesktopContextMenu,
    closeDesktopContextMenu,
  };
};
