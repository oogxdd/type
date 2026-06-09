// Provider hub for the notes navigation slice.
import { createContext, useContext, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useShallow } from "zustand/react/shallow";

import { useSelection } from "@/app/state/selection-store";
import { useEditor } from "@/features/notes/editor/hooks/editor-context";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import type { FolderNode, NoteEntry, VisibleNavigationItem } from "@/shared/types";
import type { NotePreview } from "@/shared/lib/format";
import type { TreeItem, FlattenedItem } from "@/features/notes/navigation/model/types";
import type { FeedTreeNode } from "@/features/notes/navigation/model/feed-tree-model";
import { useNotesTreeState } from "./use-notes-tree-state";
import { useNotesTreeActions } from "./use-notes-tree-actions";

type NotesTreeContextValue = {
  tree: FolderNode | null;
  treeData: TreeItem[];
  flatItems: FlattenedItem[];
  visibleItems: FlattenedItem[];
  orderedIds: string[];
  flatItemById: Map<string, FlattenedItem>;
  expanded: Set<string>;
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
  notes: NoteEntry[];
  allNotes: NoteEntry[];
  notePreviews: Record<string, NotePreview>;
  allNotePreviews: Record<string, NotePreview>;
  activeNode: FolderNode | null;
  visibleNavigationItems: VisibleNavigationItem[];
  feedVisibleNavigationItems: VisibleNavigationItem[];
  feedTreeData: FeedTreeNode[];
  feedNodeById: Map<string, FeedTreeNode>;
  activeFeedGroup: string;
  setActiveFeedGroup: Dispatch<SetStateAction<string>>;
  activeFeedNode: FeedTreeNode | null;
  feedNotes: Array<NoteEntry & { timestampMs: number }>;
  feedNotePreviews: Record<string, NotePreview>;
  feedLoading: boolean;
  parentById: Record<string, string | null>;
  renamingFolder: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  startRenameFolder: (path: string) => void;
  submitRenameFolder: () => Promise<void>;
  cancelRenameFolder: () => void;
  refreshTree: () => Promise<void>;
  createNewNote: (
    preferredFolderPath?: string,
    initialContent?: string,
    targetTimestampMs?: number
  ) => Promise<string | null>;
  deleteNotes: (paths: string[]) => Promise<boolean>;
  deleteFolders: (paths: string[]) => Promise<void>;
  moveNotesToArchive: (paths: string[]) => Promise<void>;
  moveNotesToFolder: (paths: string[], destinationPath: string) => Promise<void>;
  updateNoteMarkers: (
    paths: string[],
    markers: { archived?: boolean | null; reviewed?: boolean | null }
  ) => Promise<void>;
  flattenIntoFeed: (folderPaths: string[], notePaths: string[]) => Promise<void>;
  showNoteInfo: (path: string) => Promise<void>;
  renameFolderFromMobile: (path: string, nextName: string) => Promise<void>;
  shouldNestNotesInNavigation: boolean;
  setTree: Dispatch<SetStateAction<FolderNode | null>>;
};

const NotesTreeContext = createContext<NotesTreeContextValue | null>(null);

export function NotesTreeProvider({ children }: { children: ReactNode }) {
  const { syncSettings } = useProfiles();
  const {
    selectedFolders,
    setSelectedFolders,
    setLastSelectedFolder,
    activeFolder,
    setActiveFolder,
    setSelectedNotes,
    setLastSelectedNote,
    activeNote,
    setActiveNote,
  } = useSelection(
    useShallow((state) => ({
      selectedFolders: state.selectedFolders,
      setSelectedFolders: state.setSelectedFolders,
      setLastSelectedFolder: state.setLastSelectedFolder,
      activeFolder: state.activeFolder,
      setActiveFolder: state.setActiveFolder,
      setSelectedNotes: state.setSelectedNotes,
      setLastSelectedNote: state.setLastSelectedNote,
      activeNote: state.activeNote,
      setActiveNote: state.setActiveNote,
    }))
  );
  const { clearNote, clearDraft, rightPaneRef } = useEditor();
  const {
    tree,
    setTree,
    treeData,
    flatItems,
    visibleItems,
    orderedIds,
    flatItemById,
    expanded,
    setExpanded,
    notes,
    allNotes,
    notePreviews,
    allNotePreviews,
    activeNode,
    visibleNavigationItems,
    feedVisibleNavigationItems,
    feedTreeData,
    feedNodeById,
    activeFeedGroup,
    setActiveFeedGroup,
    activeFeedNode,
    feedNotes,
    feedNotePreviews,
    feedLoading,
    parentById,
    renamingFolder,
    setRenamingFolder,
    renameValue,
    setRenameValue,
    refreshTree,
    shouldNestNotesInNavigation,
  } = useNotesTreeState({ activeFolder, activeNote });

  const {
    createNewNote,
    deleteFolders,
    deleteNotes,
    moveNotesToArchive,
    moveNotesToFolder,
    updateNoteMarkers,
    flattenIntoFeed,
    showNoteInfo,
    renameFolderFromMobile,
    startRenameFolder,
    submitRenameFolder,
    cancelRenameFolder,
  } = useNotesTreeActions({
    tree,
    syncSettings,
    refreshTree,
    rightPaneRef,
    selectedFolders,
    setSelectedFolders,
    setLastSelectedFolder,
    activeFolder,
    setActiveFolder,
    setSelectedNotes,
    setLastSelectedNote,
    activeNote,
    setActiveNote,
    clearDraft,
    clearNote,
    renamingFolder,
    setRenamingFolder,
    renameValue,
    setRenameValue,
  });

  return (
    <NotesTreeContext.Provider
      value={{
        tree,
        treeData,
        flatItems,
        visibleItems,
        orderedIds,
        flatItemById,
        expanded,
        setExpanded,
        notes,
        allNotes,
        notePreviews,
        allNotePreviews,
        activeNode,
        visibleNavigationItems,
        feedVisibleNavigationItems,
        feedTreeData,
        feedNodeById,
        activeFeedGroup,
        setActiveFeedGroup,
        activeFeedNode,
        feedNotes,
        feedNotePreviews,
        feedLoading,
        parentById,
        renamingFolder,
        renameValue,
        setRenameValue,
        startRenameFolder,
        submitRenameFolder,
        cancelRenameFolder,
        refreshTree,
        createNewNote,
        deleteNotes,
        deleteFolders,
        moveNotesToArchive,
        moveNotesToFolder,
        updateNoteMarkers,
        flattenIntoFeed,
        showNoteInfo,
        renameFolderFromMobile,
        shouldNestNotesInNavigation,
        setTree,
      }}
    >
      {children}
    </NotesTreeContext.Provider>
  );
}

export function useNotesTree() {
  const context = useContext(NotesTreeContext);
  if (!context) {
    throw new Error("useNotesTree must be used within a NotesTreeProvider");
  }
  return context;
}
