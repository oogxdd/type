// Provider hub for the notes navigation slice.
import {
  createContext,
  useContext,
  useEffect,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { listen } from "@tauri-apps/api/event";

import { useSelection } from "@/app/state/selection-store";
import type { FolderNode, NoteEntry, VisibleNavigationItem } from "@typenotes/shared/types";
import type { NotePreview } from "@typenotes/shared/format";
import type { TreeItem, FlattenedItem } from "@/features/notes/navigation/model/types";
import type {
  FeedNoteFilter,
  FeedTreeNode,
} from "@/features/notes/navigation/model/feed-tree-model";
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
  feedNoteFilter: FeedNoteFilter;
  setFeedNoteFilter: Dispatch<SetStateAction<FeedNoteFilter>>;
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
  shouldNestNotesInNavigation: boolean;
  setTree: Dispatch<SetStateAction<FolderNode | null>>;
};

const NotesTreeContext = createContext<NotesTreeContextValue | null>(null);

export function NotesTreeProvider({ children }: { children: ReactNode }) {
  const activeFolder = useSelection((state) => state.activeFolder);
  const state = useNotesTreeState({ activeFolder });
  const actions = useNotesTreeActions({
    tree: state.tree,
    refreshTree: state.refreshTree,
    visibleNavigationItems: state.visibleNavigationItems,
    feedVisibleNavigationItems: state.feedVisibleNavigationItems,
    feedNoteFilter: state.feedNoteFilter,
    notes: state.notes,
    feedNotes: state.feedNotes,
    setActiveFeedGroup: state.setActiveFeedGroup,
    renamingFolder: state.renamingFolder,
    setRenamingFolder: state.setRenamingFolder,
    renameValue: state.renameValue,
    setRenameValue: state.setRenameValue,
  });

  // A phone pushing over local sync changes the notes on disk behind the
  // frontend's back; the backend emits this event after each accepted push.
  const { refreshTree } = state;
  useEffect(() => {
    const unlisten = listen("local-sync-push-received", () => {
      console.log("[notes] local sync push received — refreshing tree");
      void refreshTree();
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [refreshTree]);

  return (
    <NotesTreeContext.Provider value={{ ...state, ...actions }}>
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
