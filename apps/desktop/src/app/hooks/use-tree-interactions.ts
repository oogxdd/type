import {
  useCallback,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { useShallow } from "zustand/react/shallow";

import { useSelection } from "@/app/state/selection-store";
import { useEditor } from "@/features/notes/editor/hooks/editor-context";
import { useNotesTree } from "@/features/notes/navigation/state/notes-tree-context";
import { findNode } from "@/features/notes/navigation/model/tree-ops";
import { focusNoScroll } from "@/shared/lib/dom";
import { getNoteParentPath } from "@typenotes/shared/notes";
import { computeRangeSelection, resolveTargetPaths } from "@/shared/lib/selection";

type UseTreeInteractionsArgs = {
  /** The folders pane body; focused after a selection change. */
  foldersPanelRef: RefObject<HTMLDivElement | null>;
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
 * Folder/note interaction handlers for the tree UI: range-aware click
 * selection, expand/collapse toggling, and the right-click menus (rendered
 * as the React/shadcn popup menu the desktop shell owns).
 */
export const useTreeInteractions = ({
  foldersPanelRef,
}: UseTreeInteractionsArgs): TreeInteractions => {
  const { clearDraft, clearNote } = useEditor();
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
    selectFolder,
    selectNote,
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
      selectFolder: state.selectFolder,
      selectNote: state.selectNote,
    }))
  );

  const { tree, orderedIds, setExpanded, shouldNestNotesInNavigation } =
    useNotesTree();

  // Latest selection, readable from menu handlers without re-creating them.
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
    selectFolder(
      path,
      computeRangeSelection(event, selectedFolders, orderedIds, lastSelectedFolder, path)
    );
    clearDraft();
    clearNote();
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

  const handleFolderContextMenu = async (event: ReactMouseEvent, path: string) => {
    event.preventDefault();
    event.stopPropagation();
    // Keeps the existing multi-selection (and its range anchor) when the
    // target folder is already part of it.
    if (!selectedFolders.has(path)) {
      setSelectedFolders(new Set([path]));
      setLastSelectedFolder(path);
    }
    setActiveFolder(path);
    setSelectedNotes(new Set());
    setLastSelectedNote("");
    setActiveNote(null);
    clearDraft();
    clearNote();
    focusNoScroll(foldersPanelRef.current);

    setDesktopContextMenuState({
      kind: "folder",
      x: event.clientX,
      y: event.clientY,
      path,
      targetPaths: selectedFolders.has(path)
        ? resolveTargetPaths(selectedFoldersRef.current, path)
        : [path],
    });
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
    selectNote(
      notePath,
      noteParentPath,
      computeRangeSelection(event, selectedNotes, notePaths, lastSelectedNote, notePath)
    );
    if (parentPath !== undefined || shouldNestNotesInNavigation) {
      focusNoScroll(foldersPanelRef.current);
    }
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
    // Keeps the existing multi-selection (and its range anchor) when the
    // target note is already part of it.
    if (!selectedNotes.has(path)) {
      setSelectedNotes(new Set([path]));
      setLastSelectedNote(path);
    }
    setActiveNote(path);
    if (parentPath !== undefined || shouldNestNotesInNavigation) {
      focusNoScroll(foldersPanelRef.current);
    }

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
