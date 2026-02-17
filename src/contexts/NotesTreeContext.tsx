import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as api from "../data/notesApi";
import type { FolderNode, NoteEntry, VisibleNavigationItem } from "../types";
import { UNSORTED_FOLDER_PATH, ARCHIEVE_FOLDER_PATH, isSystemFolder } from "../constants";
import { collectAllNotes } from "../utils/notes";
import { useNotePreviews } from "../hooks/useNotePreviews";
import { useSessions } from "./SessionsContext";
import { useSelection } from "./SelectionContext";
import { useEditor } from "./EditorContext";
import {
  buildTreeItems,
  findNode,
  flattenTree,
} from "../utils/treeOps";
import { removeChildrenOf } from "../tree/utilities";
import { getNextNoteFileName, type NotePreview } from "../utils/format";
import { confirmAction, focusNoScroll } from "../utils/dom";
import type { TreeItem } from "../tree/types";
import type { FlattenedItem } from "../tree/types";
import { useLayoutMode } from "../mobile/useLayoutMode";
import { useTheme } from "./ThemeContext";

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
  const { activeSessionId } = useSessions();
  const { notesListMode } = useTheme();
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
  } = useSelection();
  const { clearNote, clearDraft, rightPaneRef } = useEditor();

  // -- Folder tree state
  const [tree, setTree] = useState<FolderNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));

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
  const previewSourceNotes = layoutMode === "desktop" ? notes : allNotes;
  const allNotePreviews = useNotePreviews(previewSourceNotes);
  const notePreviews = useMemo(() => {
    const previews: Record<string, NotePreview> = {};
    notes.forEach((note) => {
      const preview = allNotePreviews[note.path];
      if (preview) {
        previews[note.path] = preview;
      }
    });
    return previews;
  }, [allNotePreviews, notes]);

  const parentById = useMemo(() => {
    const map: Record<string, string | null> = {};
    flatItems.forEach((item) => {
      map[item.id] = item.parentId;
    });
    return map;
  }, [flatItems]);

  const visibleNavigationItems = useMemo(() => {
    if (!shouldNestNotesInNavigation) {
      return [] as VisibleNavigationItem[];
    }

    const items: VisibleNavigationItem[] = [];
    const walk = (nodes: TreeItem[], parentId: string | null) => {
      nodes.forEach((node) => {
        items.push({
          type: "folder",
          id: node.id,
          parentId,
        });
        const notesInNode = node.notes || [];
        const hasNestedItems = node.children.length > 0 || notesInNode.length > 0;
        if (!hasNestedItems || !expanded.has(node.id)) {
          return;
        }
        notesInNode.forEach((note) => {
          items.push({
            type: "note",
            id: note.path,
            parentId: node.id,
          });
        });
        walk(node.children, node.id);
      });
    };
    walk(treeData, null);
    return items;
  }, [expanded, shouldNestNotesInNavigation, treeData]);

  // -- Session change: reset tree state and refresh
  useEffect(() => {
    if (activeSessionId) {
      setTree(null);
    }
    void refreshTree();
  }, [activeSessionId, refreshTree]);

  // Mobile: auto-select first folder
  useEffect(() => {
    if (layoutMode === "desktop" || !tree || activeFolder) {
      return;
    }
    const unsorted = findNode(tree, UNSORTED_FOLDER_PATH);
    const firstFolderPath = unsorted?.path || tree.children[0]?.path || "";
    if (!firstFolderPath) {
      return;
    }
    setSelectedFolders(new Set([firstFolderPath]));
    setLastSelectedFolder(firstFolderPath);
    setActiveFolder(firstFolderPath);
  }, [activeFolder, layoutMode, setActiveFolder, setLastSelectedFolder, setSelectedFolders, tree]);

  // -- Debug logging
  useEffect(() => {
    console.log("[folders] activeNode", activeNode?.path || null);
  }, [activeNode]);

  // -- Create new note
  const createNewNote = useCallback(
    async (
      preferredFolderPath?: string,
      initialContent = "",
      targetTimestampMs?: number
    ) => {
      const treeSnapshot = tree ?? (await api.getTree());
      const initialFolderPath = preferredFolderPath?.trim() || UNSORTED_FOLDER_PATH;
      const targetNode =
        findNode(treeSnapshot, initialFolderPath) || findNode(treeSnapshot, UNSORTED_FOLDER_PATH);
      if (!targetNode) return null;
      const folderPath = targetNode.path;

      const fileName = getNextNoteFileName(targetNode.notes.map((n) => n.name));
      const path = `${folderPath}/${fileName}`;

      await api.writeNote(path, initialContent);
      if (typeof targetTimestampMs === "number") {
        await api.setNoteTimestamp(path, targetTimestampMs);
      }
      await api.setOrder({
        parent: folderPath,
        folderOrder: targetNode.children.map((c) => c.name),
        noteOrder: [fileName, ...targetNode.notes.map((n) => n.name)],
      });
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
    [clearDraft, refreshTree, rightPaneRef, setActiveFolder, setActiveNote, setLastSelectedFolder, setLastSelectedNote, setSelectedFolders, setSelectedNotes, tree]
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

  const submitRenameFolder = useCallback(async () => {
    if (!renamingFolder || !renameValue.trim()) {
      setRenamingFolder(null);
      return;
    }
    const wasSelected = selectedFolders.has(renamingFolder);
    const wasActive = activeFolder === renamingFolder;
    const newPath = await api.renameItem(renamingFolder, renameValue.trim());
    setRenamingFolder(null);
    setRenameValue("");
    await refreshTree();
    if (wasActive) setActiveFolder(newPath);
    if (wasSelected) {
      const nextSelected = new Set(selectedFolders);
      nextSelected.delete(renamingFolder);
      nextSelected.add(newPath);
      setSelectedFolders(nextSelected);
      setLastSelectedFolder(newPath);
    }
  }, [activeFolder, refreshTree, renamingFolder, renameValue, selectedFolders, setActiveFolder, setLastSelectedFolder, setSelectedFolders]);

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
      const wasSelected = selectedFolders.has(path);
      const wasActive = activeFolder === path;
      const newPath = await api.renameItem(path, normalizedNextName);
      await refreshTree();
      if (wasActive) {
        setActiveFolder(newPath);
      }
      if (wasSelected) {
        const nextSelected = new Set(selectedFolders);
        nextSelected.delete(path);
        nextSelected.add(newPath);
        setSelectedFolders(nextSelected);
        setLastSelectedFolder(newPath);
      }
    },
    [activeFolder, refreshTree, selectedFolders, setActiveFolder, setLastSelectedFolder, setSelectedFolders]
  );

  // -- Delete
  const deleteFolders = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      if (paths.some(isSystemFolder)) {
        window.alert(
          '"Unsorted" and "Archieve" are fixed folders and cannot be deleted.'
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

  const showNoteInfo = useCallback(async (path: string) => {
    try {
      const meta = await api.getNoteMeta(path);
      const createdLabel = meta.created_ms
        ? new Date(meta.created_ms).toLocaleString()
        : "—";
      const updatedLabel = meta.updated_ms
        ? new Date(meta.updated_ms).toLocaleString()
        : "—";
      window.alert(`Created: ${createdLabel}\nUpdated: ${updatedLabel}`);
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
