import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";
import * as api from "../api/notes-api";
import type { FolderNode, NoteEntry, VisibleNavigationItem } from "@/shared/types";
import { FEED_FOLDER_PATH, ARCHIEVE_FOLDER_PATH, isSystemFolder } from "@/shared/constants";
import { collectAllNotes, getNoteParentPath } from "@/shared/lib/notes";
import { useNotePreviews } from "./use-note-previews";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import { useSelection } from "@/app/state/selection-store";
import { useEditor } from "@/features/editor/hooks/editor-context";
import { buildTreeItems, findNode, flattenTree } from "@/features/tree/lib/tree-ops";
import { removeChildrenOf } from "@/features/tree/lib/dnd-tree";
import { type NotePreview } from "@/shared/lib/format";
import { confirmAction, focusNoScroll } from "@/shared/lib/dom";
import type { TreeItem } from "@/features/tree/lib/types";
import type { FlattenedItem } from "@/features/tree/lib/types";
import { useLayoutMode } from "@/mobile/use-layout-mode";
import { useAppearance } from "@/app/state/appearance-store";
import {
  buildFeedTree,
  buildVisibleFeedNavigationItems,
  collectFeedNotes,
  findFeedNode,
  getFirstFeedGroupId,
  type FeedTreeNode,
} from "@/features/notes/lib/feed-tree-model";
import {
  applyFolderRenameToSelection,
  buildNotePreviews,
  buildVisibleNavigationItems,
  collectNotesForFlattening,
  getFirstSelectableFolderPath,
  mapParentById,
  selectPreviewSourceNotes,
} from "@/features/notes/lib/notes-tree-model";

type NotesTreeContextValue = {
  tree: FolderNode | null;
  treeData: TreeItem[];
  flatItems: FlattenedItem[];
  visibleItems: FlattenedItem[];
  orderedIds: string[];
  flatItemById: Map<string, FlattenedItem>;
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
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
  setActiveFeedGroup: React.Dispatch<React.SetStateAction<string>>;
  activeFeedNode: FeedTreeNode | null;
  feedNotes: Array<NoteEntry & { timestampMs: number }>;
  feedNotePreviews: Record<string, NotePreview>;
  parentById: Record<string, string | null>;
  // Rename state
  renamingFolder: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  startRenameFolder: (path: string) => void;
  submitRenameFolder: () => Promise<void>;
  cancelRenameFolder: () => void;
  // Actions
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
  setTree: React.Dispatch<React.SetStateAction<FolderNode | null>>;
};

const NotesTreeContext = createContext<NotesTreeContextValue | null>(null);

export function NotesTreeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { activeProfileId, activeProfileNotesRoot, syncSettings } = useProfiles();
  const notesListMode = useAppearance((state) => state.notesListMode);
  const hideArchivedFeedNotes = useAppearance((state) => state.hideArchivedFeedNotes);
  const layoutMode = useLayoutMode();
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

  // -- Folder tree state
  const [tree, setTree] = useState<FolderNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [activeFeedGroup, setActiveFeedGroup] = useState("");

  // -- Rename state
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const shouldNestNotesInNavigation = notesListMode === "nested";

  // -- Tree data
  const refreshTree = useCallback(async () => {
    const data = await api.getTree();
    setTree(data);
  }, []);

  const treeData = useMemo(() => {
    if (!tree) return [] as TreeItem[];
    return buildTreeItems(tree);
  }, [tree]);

  const flatItems = useMemo(() => flattenTree(treeData), [treeData]);

  const visibleItems = useMemo(() => {
    const collapsedIds = flatItems
      .filter((item) => item.children.length > 0 && !expanded.has(item.id))
      .map((item) => item.id);
    return removeChildrenOf(flatItems, collapsedIds);
  }, [flatItems, expanded]);

  const orderedIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems]);
  const flatItemById = useMemo(
    () => new Map(flatItems.map((item) => [item.id, item] as const)),
    [flatItems]
  );

  const activeNode = useMemo(() => findNode(tree, activeFolder), [tree, activeFolder]);

  const notes = useMemo(() => activeNode?.notes || [], [activeNode]);
  const allNotes = useMemo(() => collectAllNotes(tree), [tree]);
  const feedSourceNotes = useMemo(
    () => allNotes.filter((note) => getNoteParentPath(note.path) === FEED_FOLDER_PATH),
    [allNotes]
  );
  const shouldWarmNotePreviews =
    layoutMode !== "phone" || Boolean(activeFolder) || Boolean(activeNote);
  const previewSourceNotes = useMemo<NoteEntry[]>(
    () =>
      shouldWarmNotePreviews
        ? selectPreviewSourceNotes({
            layoutMode,
            activeFolder,
            activeNote,
            notes,
            allNotes,
            shouldNestNotesInNavigation,
          })
        : [],
    [
      shouldWarmNotePreviews,
      layoutMode,
      activeFolder,
      activeNote,
      notes,
      allNotes,
      shouldNestNotesInNavigation,
    ]
  );
  const allNotePreviews = useNotePreviews(previewSourceNotes);
  const notePreviews = useMemo(() => buildNotePreviews(notes, allNotePreviews), [allNotePreviews, notes]);
  const feedTree = useMemo(
    () => buildFeedTree(feedSourceNotes, allNotePreviews, hideArchivedFeedNotes),
    [allNotePreviews, feedSourceNotes, hideArchivedFeedNotes]
  );
  const feedTreeData = feedTree.treeData;
  const feedNodeById = feedTree.nodeById;
  const feedVisibleNavigationItems = useMemo(
    () =>
      buildVisibleFeedNavigationItems(
        feedTreeData,
        expanded,
        shouldNestNotesInNavigation
      ),
    [expanded, feedTreeData, shouldNestNotesInNavigation]
  );

  useEffect(() => {
    if (feedTreeData.length === 0) {
      if (activeFeedGroup) {
        setActiveFeedGroup("");
      }
      return;
    }
    if (!activeFeedGroup || !feedNodeById.has(activeFeedGroup)) {
      setActiveFeedGroup(getFirstFeedGroupId(feedTreeData));
    }
  }, [activeFeedGroup, feedNodeById, feedTreeData]);

  const activeFeedNode = useMemo(
    () => findFeedNode(feedTreeData, activeFeedGroup),
    [activeFeedGroup, feedTreeData]
  );
  const feedNotes = useMemo(
    () => collectFeedNotes(activeFeedNode),
    [activeFeedNode]
  );
  const feedNotePreviews = useMemo(
    () => buildNotePreviews(feedNotes, allNotePreviews),
    [allNotePreviews, feedNotes]
  );

  const parentById = useMemo(() => mapParentById(flatItems), [flatItems]);

  const visibleNavigationItems = useMemo(
    () => buildVisibleNavigationItems(treeData, expanded, shouldNestNotesInNavigation),
    [expanded, shouldNestNotesInNavigation, treeData]
  );

  // -- Profile change: reset tree state and refresh
  useEffect(() => {
    if (!activeProfileId) {
      return;
    }
    setTree(null);
    void refreshTree();
  }, [activeProfileId, activeProfileNotesRoot, refreshTree]);

  useEffect(() => {
    const onTreeInvalidated = () => {
      void refreshTree();
    };
    window.addEventListener("notes-tree-invalidated", onTreeInvalidated);
    return () => window.removeEventListener("notes-tree-invalidated", onTreeInvalidated);
  }, [refreshTree]);

  // Mobile: auto-select first folder
  useEffect(() => {
    if (layoutMode !== "tablet" || !tree || activeFolder) {
      return;
    }
    const firstFolderPath = getFirstSelectableFolderPath(tree);
    if (!firstFolderPath) {
      return;
    }
    setSelectedFolders(new Set([firstFolderPath]));
    setLastSelectedFolder(firstFolderPath);
    setActiveFolder(firstFolderPath);
  }, [activeFolder, layoutMode, setActiveFolder, setLastSelectedFolder, setSelectedFolders, tree]);

  // -- Create new note
  const createNewNote = useCallback(
    async (
      preferredFolderPath?: string,
      initialContent = "",
      targetTimestampMs?: number
    ) => {
      const treeSnapshot = tree ?? (await api.getTree());
      const initialFolderPath = preferredFolderPath?.trim() || FEED_FOLDER_PATH;
      const targetNode =
        findNode(treeSnapshot, initialFolderPath) || findNode(treeSnapshot, FEED_FOLDER_PATH);
      if (!targetNode) return null;
      const folderPath = targetNode.path;
      const created = await api.createNote(
        folderPath,
        initialContent,
        targetTimestampMs,
        syncSettings.noteFileNameFormat
      );
      const path = created.path;
      await refreshTree();

      setSelectedFolders(new Set([folderPath]));
      setLastSelectedFolder(folderPath);
      setActiveFolder(folderPath);
      setSelectedNotes(new Set([path]));
      setLastSelectedNote(path);
      setActiveNote(path);
      clearDraft();

      requestAnimationFrame(() => {
        const editorElement =
          rightPaneRef.current?.querySelector<HTMLElement>(
            ".tiptap-content[contenteditable='true']"
          ) || rightPaneRef.current;
        focusNoScroll(editorElement);
      });

      return path;
    },
    [
      clearDraft,
      refreshTree,
      rightPaneRef,
      setActiveFolder,
      setActiveNote,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
      syncSettings.noteFileNameFormat,
      tree,
    ]
  );

  // -- Rename
  const startRenameFolder = useCallback((path: string) => {
    if (isSystemFolder(path)) {
      window.alert(`"${path}" is a fixed folder and cannot be renamed.`);
      return;
    }
    const name = path.split("/").pop() || "";
    setRenamingFolder(path);
    setRenameValue(name);
  }, []);

  // Carry an active/selected folder over to its new path after a rename.
  const applyFolderRename = useCallback(
    (oldPath: string, newPath: string) => {
      const next = applyFolderRenameToSelection(activeFolder, selectedFolders, oldPath, newPath);
      setActiveFolder(next.activeFolder);
      if (next.selectedFolderChanged) {
        setSelectedFolders(next.selectedFolders);
        setLastSelectedFolder(newPath);
      }
    },
    [activeFolder, selectedFolders, setActiveFolder, setLastSelectedFolder, setSelectedFolders]
  );

  const submitRenameFolder = useCallback(async () => {
    if (!renamingFolder || !renameValue.trim()) {
      setRenamingFolder(null);
      return;
    }
    const oldPath = renamingFolder;
    const newPath = await api.renameItem(oldPath, renameValue.trim());
    setRenamingFolder(null);
    setRenameValue("");
    await refreshTree();
    applyFolderRename(oldPath, newPath);
  }, [applyFolderRename, refreshTree, renamingFolder, renameValue]);

  const cancelRenameFolder = useCallback(() => {
    setRenamingFolder(null);
    setRenameValue("");
  }, []);

  const renameFolderFromMobile = useCallback(
    async (path: string, nextName: string) => {
      if (isSystemFolder(path)) {
        window.alert(`"${path}" is a fixed folder and cannot be renamed.`);
        return;
      }
      const currentName = path.split("/").pop() || "";
      const normalizedNextName = nextName.trim();
      if (!normalizedNextName || normalizedNextName === currentName) {
        return;
      }
      const newPath = await api.renameItem(path, normalizedNextName);
      await refreshTree();
      applyFolderRename(path, newPath);
    },
    [applyFolderRename, refreshTree]
  );

  // -- Delete
  const deleteFolders = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      if (paths.some(isSystemFolder)) {
        window.alert(
          '"Feed" and "Archieve" are fixed folders and cannot be deleted.'
        );
        return;
      }
      const confirmed = await confirmAction(`Delete ${paths.length} folder(s)?`);
      if (!confirmed) return;
      await api.deleteItems(paths);
      setSelectedFolders(new Set());
      if (paths.includes(activeFolder)) setActiveFolder("");
      await refreshTree();
    },
    [activeFolder, refreshTree, setActiveFolder, setSelectedFolders]
  );

  const deleteNotes = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return false;
      const confirmed = await confirmAction(`Delete ${paths.length} note(s)?`);
      if (!confirmed) return false;
      await api.deleteItems(paths);
      setSelectedNotes(new Set());
      setLastSelectedNote("");
      if (paths.includes(activeNote || "")) {
        setActiveNote(null);
        clearNote();
      }
      await refreshTree();
      return true;
    },
    [activeNote, clearNote, refreshTree, setActiveNote, setLastSelectedNote, setSelectedNotes]
  );

  const moveNotesToArchive = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      await api.moveItems(paths, ARCHIEVE_FOLDER_PATH);
      setSelectedNotes(new Set());
      setLastSelectedNote("");
      setActiveNote(null);
      clearNote();
      setSelectedFolders(new Set([ARCHIEVE_FOLDER_PATH]));
      setLastSelectedFolder(ARCHIEVE_FOLDER_PATH);
      setActiveFolder(ARCHIEVE_FOLDER_PATH);
      await refreshTree();
    },
    [clearNote, refreshTree, setActiveFolder, setActiveNote, setLastSelectedFolder, setLastSelectedNote, setSelectedFolders, setSelectedNotes]
  );

  const moveNotesToFolder = useCallback(
    async (paths: string[], destinationPath: string) => {
      const normalizedDestination = destinationPath.trim();
      if (paths.length === 0 || !normalizedDestination) {
        return;
      }
      await api.moveItems(paths, normalizedDestination);
      setSelectedNotes(new Set());
      setLastSelectedNote("");
      setActiveNote(null);
      clearNote();
      setSelectedFolders(new Set([normalizedDestination]));
      setLastSelectedFolder(normalizedDestination);
      setActiveFolder(normalizedDestination);
      await refreshTree();
    },
    [
      clearNote,
      refreshTree,
      setActiveFolder,
      setActiveNote,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
    ]
  );

  const updateNoteMarkers = useCallback(
    async (
      paths: string[],
      markers: { archived?: boolean | null; reviewed?: boolean | null }
    ) => {
      const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
      if (uniquePaths.length === 0) {
        return;
      }
      await Promise.all(
        uniquePaths.map((path) =>
          api.updateNoteMarkers({
            path,
            archived: markers.archived ?? null,
            reviewed: markers.reviewed ?? null,
          })
        )
      );
      window.dispatchEvent(new CustomEvent("note-previews-invalidated"));
    },
    []
  );

  // Collapse a selection of folders + notes into Feed: every note under the
  // chosen folders (recursively) plus any directly-chosen notes is moved into
  // Feed, then the emptied (non-system) folders are removed. Notes keep their
  // frontmatter — and therefore their original dates — since this is a move.
  const flattenIntoFeed = useCallback(
    async (folderPaths: string[], notePaths: string[]) => {
      const treeSnapshot = tree;
      if (!treeSnapshot) return;

      const { notePaths: notePathsToMove, foldersToRemove } = collectNotesForFlattening(
        treeSnapshot,
        folderPaths,
        notePaths
      );

      const notesToMove = notePathsToMove.filter(
        (path) => getNoteParentPath(path) !== FEED_FOLDER_PATH
      );
      if (notesToMove.length === 0 && foldersToRemove.length === 0) return;

      const folderSuffix =
        foldersToRemove.length > 0
          ? ` and remove ${foldersToRemove.length} folder(s)`
          : "";
      const confirmed = await confirmAction(
        `Move ${notesToMove.length} note(s) into Feed${folderSuffix}?`
      );
      if (!confirmed) return;

      if (notesToMove.length > 0) {
        await api.moveItems(notesToMove, FEED_FOLDER_PATH);
      }
      if (foldersToRemove.length > 0) {
        await api.deleteItems(foldersToRemove);
      }

      setSelectedFolders(new Set([FEED_FOLDER_PATH]));
      setLastSelectedFolder(FEED_FOLDER_PATH);
      setActiveFolder(FEED_FOLDER_PATH);
      setSelectedNotes(new Set());
      setLastSelectedNote("");
      await refreshTree();
    },
    [
      refreshTree,
      setActiveFolder,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
      tree,
    ]
  );

  const showNoteInfo = useCallback(async (path: string) => {
    try {
      const meta = await api.getNoteMeta(path);
      const createdLabel = meta.created_ms
        ? new Date(meta.created_ms).toLocaleString()
        : "—";
      const updatedLabel = meta.updated_ms
        ? new Date(meta.updated_ms).toLocaleString()
        : "—";
      const archivedLabel = meta.archived_ms
        ? new Date(meta.archived_ms).toLocaleString()
        : "—";
      const reviewedLabel = meta.reviewed_ms
        ? new Date(meta.reviewed_ms).toLocaleString()
        : "—";
      window.alert(
        `Created: ${createdLabel}\nUpdated: ${updatedLabel}\nArchived: ${archivedLabel}\nReviewed: ${reviewedLabel}`
      );
    } catch (error) {
      console.error("[notes] failed to show note info", error);
    }
  }, []);

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
