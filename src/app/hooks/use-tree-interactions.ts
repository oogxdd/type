import { useRef, type RefObject, type MouseEvent as ReactMouseEvent } from "react";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu } from "@tauri-apps/api/menu";

import { useSelection } from "@/app/state/selection-context";
import { useNotesTree } from "@/features/notes/hooks/notes-tree-context";
import { findNode } from "@/features/tree/lib/tree-ops";
import { focusNoScroll } from "@/shared/lib/dom";
import { getNoteParentPath } from "@/shared/lib/notes";
import { computeRangeSelection, resolveTargetPaths } from "@/shared/lib/selection";

type UseTreeInteractionsArgs = {
  /** The folders pane body; focused after a selection change. */
  foldersPanelRef: RefObject<HTMLDivElement | null>;
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
};

/**
 * Folder/note interaction handlers shared by the desktop and mobile shells:
 * range-aware click selection, expand/collapse toggling, and the native Tauri
 * right-click menus (rename/delete folder; note info / delete / archive). Reads
 * Selection + NotesTree from context directly; the only collaborator it can't
 * reach that way is the folders-pane DOM node, passed in for post-action focus.
 *
 * It lives in app/hooks rather than features/tree because it depends on
 * NotesTree, and notes-tree-context already depends on features/tree/lib —
 * routing this glue through the composition root keeps that edge one-way.
 */
export const useTreeInteractions = ({
  foldersPanelRef,
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
  } = useSelection();

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
  };
};
