import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu } from "@tauri-apps/api/menu";
import { Settings } from "lucide-react";
import "./App.css";

// Data layer
import * as api from "./data/notesApi";

// Hooks
import { useNoteEditor } from "./hooks/useNoteEditor";
import { useNotePreviews } from "./hooks/useNotePreviews";

// Components
import { DROP_PREFIX, FoldersPanel } from "./components/FoldersPanel";
import { NoteRow } from "./components/NoteRow";
import { NoteEditor } from "./components/NoteEditor";
import {
  SettingsMiddlePane,
  SettingsDetailPane,
  type ThemeMode,
} from "./components/SettingsPanel";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable";

// Utils
import {
  buildTreeItems,
  findNode,
  findParentAndIndex,
  getNodeById,
  removeNodes,
  insertNodes,
  parseDropTargetId,
  sortIdsByTreeOrder,
  isInDraggedSubtree,
  getTopLevelSelected,
  arraysEqual,
  buildFolderOrderMap,
  applyFolderOrder,
  buildNoteOrderMap,
  reorderList,
  flattenTree,
} from "./utils/treeOps";
import { focusNoScroll, scrollIntoViewIfNeeded, escapeSelectorValue, confirmAction } from "./utils/dom";
import { getNextNoteFileName } from "./utils/format";

// Types
import type { DragData, FolderNode } from "./types";
import type { TreeItem } from "./tree/types";
import { removeChildrenOf } from "./tree/utilities";

const indentationWidth = 18;

type AppMode = "notes" | "settings";
type PaneId = "folders" | "middle" | "right";

const getInitialTheme = (): ThemeMode => {
  if (typeof window === "undefined") {
    return "dark";
  }
  const stored = window.localStorage.getItem("notes-viewer-theme");
  if (stored === "dark" || stored === "light") {
    return stored;
  }
  return "dark";
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  // -- Theme & layout -------------------------------------------------------
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [panelLayout, setPanelLayout] = useState<Record<string, number>>({
    nav: 22,
    middle: 25,
    content: 53,
  });
  const [editorFontSize, setEditorFontSize] = useState(14);
  const [appMode, setAppMode] = useState<AppMode>("notes");
  const [activeSettingsSection, setActiveSettingsSection] = useState("general");

  // -- Folder tree state ----------------------------------------------------
  const [tree, setTree] = useState<FolderNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [lastSelectedFolder, setLastSelectedFolder] = useState("");
  const [activeFolder, setActiveFolder] = useState("");

  // -- Note selection state -------------------------------------------------
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
  const [lastSelectedNote, setLastSelectedNote] = useState("");
  const [activeNote, setActiveNote] = useState<string | null>(null);

  // -- Rename state ---------------------------------------------------------
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // -- Drag-drop state ------------------------------------------------------
  const [activeId, setActiveId] = useState<string | null>(null);
  const [edgeSnap, setEdgeSnap] = useState<{
    id: string;
    position: "before" | "after";
  } | null>(null);
  const activeDrag = useRef<DragData | null>(null);
  const dragStartPoint = useRef<{ x: number; y: number } | null>(null);
  const expandTimeoutRef = useRef<number | null>(null);
  const expandTargetRef = useRef<string | null>(null);

  // -- Refs -----------------------------------------------------------------
  const notesPanelRef = useRef<HTMLDivElement | null>(null);
  const foldersPanelRef = useRef<HTMLDivElement | null>(null);
  const middlePaneRef = useRef<HTMLDivElement | null>(null);
  const rightPaneRef = useRef<HTMLDivElement | null>(null);
  const lastLeftPaneFocusRef = useRef<"folders" | "middle">("middle");
  const folderContextPathRef = useRef<string | null>(null);
  const noteContextPathRef = useRef<string | null>(null);
  const selectedFoldersRef = useRef<Set<string>>(new Set());
  const selectedNotesRef = useRef<Set<string>>(new Set());
  const folderMenuPromiseRef = useRef<Promise<Menu> | null>(null);
  const noteMenuPromiseRef = useRef<Promise<Menu> | null>(null);

  // -- Hooks ----------------------------------------------------------------
  const { noteContent, draftNoteContent, handleEditorChange, clearNote } =
    useNoteEditor(activeNote);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // -- Sync refs to state ---------------------------------------------------
  useEffect(() => {
    console.log("[folders] selectedFolders", Array.from(selectedFolders));
    selectedFoldersRef.current = selectedFolders;
  }, [selectedFolders]);

  useEffect(() => {
    selectedNotesRef.current = selectedNotes;
  }, [selectedNotes]);

  // -- Theme persistence ----------------------------------------------------
  useEffect(() => {
    window.localStorage.setItem("notes-viewer-theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // -- Debug logging --------------------------------------------------------
  useEffect(() => {
    console.log("[folders] activeFolder", activeFolder);
  }, [activeFolder]);

  // -- Tree data ------------------------------------------------------------
  const refreshTree = useCallback(async () => {
    const data = await api.getTree();
    setTree(data);
  }, []);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

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

  const parentById = useMemo(() => {
    const map: Record<string, string | null> = {};
    flatItems.forEach((item) => {
      map[item.id] = item.parentId;
    });
    return map;
  }, [flatItems]);

  const activeNode = useMemo(() => findNode(tree, activeFolder), [tree, activeFolder]);

  useEffect(() => {
    console.log("[folders] activeNode", activeNode?.path || null);
  }, [activeNode]);

  const notes = activeNode?.notes || [];
  const notePreviews = useNotePreviews(notes);

  // -- Create new note ------------------------------------------------------
  const createNewNote = useCallback(async () => {
    if (appMode !== "notes") setAppMode("notes");
    const folderPath = activeFolder;
    const targetNode = activeNode ?? findNode(tree, folderPath);
    if (!targetNode) return;

    const fileName = getNextNoteFileName(targetNode.notes.map((n) => n.name));
    const path = folderPath ? `${folderPath}/${fileName}` : fileName;

    await api.writeNote(path, "");
    await api.setOrder({
      parent: folderPath,
      folderOrder: targetNode.children.map((c) => c.name),
      noteOrder: [...targetNode.notes.map((n) => n.name), fileName],
    });
    await refreshTree();

    if (folderPath) {
      setSelectedFolders(new Set([folderPath]));
      setLastSelectedFolder(folderPath);
      setActiveFolder(folderPath);
    } else {
      setSelectedFolders(new Set());
      setLastSelectedFolder("");
      setActiveFolder("");
    }
    setSelectedNotes(new Set([path]));
    setLastSelectedNote(path);
    setActiveNote(path);

    requestAnimationFrame(() => {
      const editorElement =
        rightPaneRef.current?.querySelector<HTMLElement>(
          ".tiptap-content[contenteditable='true']"
        ) || rightPaneRef.current;
      focusNoScroll(editorElement);
    });
  }, [activeFolder, activeNode, appMode, refreshTree, tree]);

  // -- App style ------------------------------------------------------------
  const appStyle = useMemo(
    () => ({ "--editor-font-size": `${editorFontSize}px` }) as CSSProperties,
    [editorFontSize]
  );

  // -- Folder handlers ------------------------------------------------------
  const handleFolderClick = (event: ReactMouseEvent, path: string) => {
    event.stopPropagation();
    const nextSelected = new Set(selectedFolders);
    if (event.shiftKey && lastSelectedFolder) {
      const visibleFolders = orderedIds;
      const start = visibleFolders.indexOf(lastSelectedFolder);
      const end = visibleFolders.indexOf(path);
      if (start !== -1 && end !== -1) {
        const [from, to] = start < end ? [start, end] : [end, start];
        nextSelected.clear();
        visibleFolders.slice(from, to + 1).forEach((p) => nextSelected.add(p));
      } else {
        nextSelected.clear();
        nextSelected.add(path);
      }
    } else if (event.metaKey || event.ctrlKey) {
      if (nextSelected.has(path)) nextSelected.delete(path);
      else nextSelected.add(path);
    } else {
      nextSelected.clear();
      nextSelected.add(path);
    }
    setSelectedFolders(nextSelected);
    setLastSelectedFolder(path);
    setActiveFolder(path);
    setSelectedNotes(new Set());
    setActiveNote(null);
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

  const startRenameFolder = (path: string) => {
    const name = path.split("/").pop() || "";
    setRenamingFolder(path);
    setRenameValue(name);
  };

  const submitRenameFolder = async () => {
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
  };

  const deleteFolders = async (paths: string[]) => {
    if (paths.length === 0) return;
    const confirmed = await confirmAction(`Delete ${paths.length} folder(s)?`);
    if (!confirmed) return;
    await api.deleteItems(paths);
    setSelectedFolders(new Set());
    if (paths.includes(activeFolder)) setActiveFolder("");
    await refreshTree();
  };

  // -- Folder context menu --------------------------------------------------
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
              const selected = selectedFoldersRef.current;
              const paths =
                selected.size > 1 && selected.has(path)
                  ? Array.from(selected)
                  : [path];
              void deleteFolders(paths);
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
    setActiveNote(null);
    folderContextPathRef.current = path;
    const menu = await getFolderNativeMenu();
    await menu.popup(new LogicalPosition(event.clientX, event.clientY));
  };

  // -- Note handlers --------------------------------------------------------
  const handleNoteClick = (notePath: string, event: ReactMouseEvent) => {
    if (!activeNode) return;
    const notePaths = activeNode.notes.map((n) => n.path);
    const nextSelected = new Set(selectedNotes);
    if (event.shiftKey && lastSelectedNote) {
      const start = notePaths.indexOf(lastSelectedNote);
      const end = notePaths.indexOf(notePath);
      if (start !== -1 && end !== -1) {
        const [from, to] = start < end ? [start, end] : [end, start];
        nextSelected.clear();
        notePaths.slice(from, to + 1).forEach((p) => nextSelected.add(p));
      } else {
        nextSelected.clear();
        nextSelected.add(notePath);
      }
    } else if (event.metaKey || event.ctrlKey) {
      if (nextSelected.has(notePath)) nextSelected.delete(notePath);
      else nextSelected.add(notePath);
    } else {
      nextSelected.clear();
      nextSelected.add(notePath);
    }
    setSelectedNotes(nextSelected);
    setLastSelectedNote(notePath);
    setActiveNote(notePath);
  };

  const deleteNotes = async (paths: string[]) => {
    if (paths.length === 0) return;
    const confirmed = await confirmAction(`Delete ${paths.length} note(s)?`);
    if (!confirmed) return;
    await api.deleteItems(paths);
    setSelectedNotes(new Set());
    if (paths.includes(activeNote || "")) {
      setActiveNote(null);
      clearNote();
    }
    await refreshTree();
  };

  const showNoteInfo = async (path: string) => {
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
  };

  // -- Note context menu ----------------------------------------------------
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
              const selected = selectedNotesRef.current;
              const paths =
                selected.size > 1 && selected.has(path)
                  ? Array.from(selected)
                  : [path];
              void deleteNotes(paths);
            },
          },
        ],
      });
    }
    return noteMenuPromiseRef.current;
  };

  const handleNoteContextMenu = async (event: ReactMouseEvent, path: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedNotes.has(path)) {
      setSelectedNotes(new Set([path]));
      setLastSelectedNote(path);
    }
    setActiveNote(path);
    noteContextPathRef.current = path;
    const menu = await getNoteNativeMenu();
    await menu.popup(new LogicalPosition(event.clientX, event.clientY));
  };

  // -- Drag & drop ----------------------------------------------------------
  const handleDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const data = active.data.current as DragData | undefined;
    if (!data) return;
    activeDrag.current = data;
    api.logGroup("drag start", {
      type: data.type,
      path: "path" in data ? data.path : undefined,
      id: active.id.toString(),
    });
    if (data.type === "folder") {
      const point =
        activatorEvent instanceof globalThis.MouseEvent
          ? { x: activatorEvent.clientX, y: activatorEvent.clientY }
          : null;
      dragStartPoint.current = point;
      setActiveId(active.id.toString());
      setSelectedFolders((prev) =>
        prev.has(data.path) ? prev : new Set([data.path])
      );
      setLastSelectedFolder(data.path);
      document.body.style.setProperty("cursor", "grabbing");
    }
    if (data.type === "note") {
      setSelectedNotes((prev) =>
        prev.has(data.path) ? prev : new Set([data.path])
      );
      setLastSelectedNote(data.path);
      setActiveNote(data.path);
    }
  };

  const handleDragMove = (event: DragMoveEvent) => {
    if (activeDrag.current?.type !== "folder") return;
    const { active, over } = event;
    if (!active || !over) {
      setEdgeSnap(null);
      if (expandTimeoutRef.current) {
        window.clearTimeout(expandTimeoutRef.current);
        expandTimeoutRef.current = null;
      }
      expandTargetRef.current = null;
      return;
    }
    const dropTarget = parseDropTargetId(over.id);
    if (!dropTarget || dropTarget.type !== "item" || dropTarget.position !== "inside") {
      setEdgeSnap(null);
      if (expandTimeoutRef.current) {
        window.clearTimeout(expandTimeoutRef.current);
        expandTimeoutRef.current = null;
      }
      expandTargetRef.current = null;
      return;
    }

    const overNode = getNodeById(treeData, dropTarget.itemId);
    const hasChildren = Boolean(overNode?.children && overNode.children.length > 0);
    const isCollapsed = hasChildren && !expanded.has(dropTarget.itemId);
    if (isCollapsed) {
      if (expandTargetRef.current !== dropTarget.itemId) {
        if (expandTimeoutRef.current) window.clearTimeout(expandTimeoutRef.current);
        expandTargetRef.current = dropTarget.itemId;
        expandTimeoutRef.current = window.setTimeout(() => {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.add(dropTarget.itemId);
            return next;
          });
        }, 500);
      }
    } else if (expandTargetRef.current) {
      if (expandTimeoutRef.current) {
        window.clearTimeout(expandTimeoutRef.current);
        expandTimeoutRef.current = null;
      }
      expandTargetRef.current = null;
    }

    const overRect = over.rect;
    if (!overRect) {
      setEdgeSnap(null);
      return;
    }

    let pointerY: number | null = null;
    if (dragStartPoint.current && typeof event.delta?.y === "number") {
      pointerY = dragStartPoint.current.y + event.delta.y;
    } else {
      const activeRect = active.rect.current?.translated ?? active.rect.current?.initial;
      if (activeRect) pointerY = activeRect.top + activeRect.height / 2;
    }

    if (pointerY === null) {
      setEdgeSnap(null);
      return;
    }

    const height = overRect.bottom - overRect.top;
    const threshold = Math.min(14, height * 0.35);

    if (pointerY < overRect.top + threshold) {
      setEdgeSnap({ id: dropTarget.itemId, position: "before" });
      return;
    }
    if (pointerY > overRect.bottom - threshold) {
      if (hasChildren) {
        setEdgeSnap(null);
        return;
      }
      setEdgeSnap({ id: dropTarget.itemId, position: "after" });
      return;
    }
    setEdgeSnap(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (activeDrag.current?.type !== "folder") return;
    if (!event.over) setEdgeSnap(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    const data = active.data.current as DragData | undefined;
    const overData = over?.data.current as DragData | undefined;
    if (!data) return;

    if (data.type === "folder") {
      setActiveId(null);
      setEdgeSnap(null);
      document.body.style.setProperty("cursor", "");
      dragStartPoint.current = null;
      activeDrag.current = null;
      if (expandTimeoutRef.current) {
        window.clearTimeout(expandTimeoutRef.current);
        expandTimeoutRef.current = null;
      }
      expandTargetRef.current = null;

      if (!over) return;

      const resolvedId =
        edgeSnap ? `${DROP_PREFIX}:${edgeSnap.id}:${edgeSnap.position}` : over.id;
      const dropTarget = parseDropTargetId(resolvedId);
      if (!dropTarget) {
        api.logGroup("drop ignored", { reason: "invalid target", overId: over.id });
        return;
      }

      const selectedIdsList = Array.from(selectedFolders);
      const draggingIds = getTopLevelSelected(selectedIdsList, parentById);
      if (draggingIds.length === 0) {
        api.logGroup("drop ignored", { reason: "no dragging ids" });
        return;
      }

      if (dropTarget.type === "item" && draggingIds.includes(dropTarget.itemId)) {
        api.logGroup("drop ignored", { reason: "target is dragged item", target: dropTarget });
        return;
      }

      if (
        dropTarget.type === "item" &&
        isInDraggedSubtree(treeData, draggingIds, dropTarget.itemId)
      ) {
        api.logGroup("drop ignored", {
          reason: "target inside dragged subtree",
          target: dropTarget,
        });
        return;
      }

      const orderedDraggingIds = sortIdsByTreeOrder(draggingIds, orderedIds);
      const { tree: prunedTree, removed } = removeNodes(treeData, orderedDraggingIds);
      const removedMap = new Map(removed.map((node) => [node.id, node]));
      const nodesToInsert = orderedDraggingIds
        .map((id) => removedMap.get(id))
        .filter(Boolean) as TreeItem[];

      if (nodesToInsert.length === 0) return;

      let targetParentId: string | null = null;
      let targetIndex = 0;

      if (dropTarget.type === "root") {
        targetParentId = null;
        targetIndex = prunedTree.length;
      } else if (dropTarget.position === "inside") {
        targetParentId = dropTarget.itemId;
        const parentNode = getNodeById(prunedTree, dropTarget.itemId);
        targetIndex = parentNode?.children?.length ?? 0;
      } else {
        const position = findParentAndIndex(prunedTree, dropTarget.itemId);
        if (!position) return;
        targetParentId = position.parentId;
        targetIndex = position.index + (dropTarget.position === "after" ? 1 : 0);
      }

      const nextTree = insertNodes(prunedTree, targetParentId, targetIndex, nodesToInsert);
      api.logGroup("folder drag drop", {
        dropTarget,
        draggingIds: orderedDraggingIds,
        targetParentId: targetParentId ?? "",
        targetIndex,
        selectedFolders: Array.from(selectedFolders),
      });

      const oldParentById: Record<string, string | null> = {};
      flatItems.forEach((item) => {
        oldParentById[item.id] = item.parentId;
      });
      const newParentById: Record<string, string | null> = {};
      flattenTree(nextTree).forEach((item) => {
        newParentById[item.id] = item.parentId;
      });

      for (const id of orderedDraggingIds) {
        const oldParent = oldParentById[id] ?? null;
        const newParent = newParentById[id] ?? null;
        if (oldParent !== newParent) {
          await api.moveItems([id], newParent ?? "");
        }
      }

      const noteOrderMap: Record<string, string[]> = {};
      buildNoteOrderMap(tree, noteOrderMap);

      const currentOrderMap: Record<string, string[]> = {};
      const nextOrderMap: Record<string, string[]> = {};
      buildFolderOrderMap(treeData, null, currentOrderMap);
      buildFolderOrderMap(nextTree, null, nextOrderMap);

      const changedParents = Object.keys(nextOrderMap).filter(
        (parent) => !arraysEqual(nextOrderMap[parent], currentOrderMap[parent])
      );

      api.logGroup("folder order delta", {
        changedParents,
        totalParents: Object.keys(nextOrderMap).length,
      });

      for (const parentPath of changedParents) {
        await api.setOrder({
          parent: parentPath,
          folderOrder: nextOrderMap[parentPath],
          noteOrder: noteOrderMap[parentPath] || [],
        });
      }

      if (changedParents.length > 0 && tree) {
        setTree(applyFolderOrder(tree, nextOrderMap));
      }

      if (orderedDraggingIds.some((id) => oldParentById[id] !== newParentById[id])) {
        await refreshTree();
      }
      return;
    }

    if (data.type === "note") {
      activeDrag.current = null;
      if (!over || !overData) {
        api.logGroup("note drop ignored", { reason: "missing target" });
        return;
      }
      const selectedList = selectedNotes.has(data.path)
        ? Array.from(selectedNotes)
        : [data.path];
      if (overData.type === "folder") {
        api.logGroup("note move to folder", {
          notes: selectedList,
          destination: overData.path,
        });
        await api.moveItems(selectedList, overData.path);
        if (selectedList.includes(activeNote || "")) {
          setActiveNote(null);
          clearNote();
        }
        setSelectedNotes(new Set());
        await refreshTree();
        return;
      }
      if (overData.type === "note" && activeNode) {
        if (selectedList.includes(overData.path)) return;
        const notePaths = activeNode.notes.map((n) => n.path);
        const newOrder = reorderList(notePaths, selectedList, overData.path);
        const folderOrder = activeNode.children.map((c) => c.name);
        const noteOrder = newOrder.map((p) => p.split("/").pop() || p);
        api.logGroup("note reorder", {
          parent: activeNode.path,
          dragging: selectedList,
          over: overData.path,
          noteOrder,
          folderOrder,
        });
        await api.setOrder({
          parent: activeNode.path,
          folderOrder,
          noteOrder,
        });
        await refreshTree();
      }
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setEdgeSnap(null);
    document.body.style.setProperty("cursor", "");
    dragStartPoint.current = null;
    activeDrag.current = null;
    if (expandTimeoutRef.current) {
      window.clearTimeout(expandTimeoutRef.current);
      expandTimeoutRef.current = null;
    }
    expandTargetRef.current = null;
  };

  // -- Keyboard navigation --------------------------------------------------
  useEffect(() => {
    const getFocusedPane = (): PaneId | null => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (!activeElement) return null;
      if (
        foldersPanelRef.current &&
        (activeElement === foldersPanelRef.current ||
          foldersPanelRef.current.contains(activeElement))
      )
        return "folders";
      if (
        middlePaneRef.current &&
        (activeElement === middlePaneRef.current ||
          middlePaneRef.current.contains(activeElement))
      )
        return "middle";
      if (
        rightPaneRef.current &&
        (activeElement === rightPaneRef.current ||
          rightPaneRef.current.contains(activeElement))
      )
        return "right";
      return null;
    };

    const focusPane = (pane: PaneId) => {
      if (pane === "folders") {
        focusNoScroll(foldersPanelRef.current);
        return;
      }
      if (pane === "middle") {
        focusNoScroll(middlePaneRef.current);
        return;
      }
      const editorElement =
        appMode === "notes"
          ? rightPaneRef.current?.querySelector<HTMLElement>(
              ".tiptap-content[contenteditable='true']"
            ) || rightPaneRef.current
          : rightPaneRef.current;
      focusNoScroll(editorElement);
    };

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.repeat) return;
      const code = event.code;
      if (
        code !== "KeyT" &&
        code !== "KeyW" &&
        code !== "KeyK" &&
        code !== "KeyJ" &&
        code !== "KeyN" &&
        code !== "Equal" &&
        code !== "Minus" &&
        code !== "Digit0" &&
        code !== "NumpadAdd" &&
        code !== "NumpadSubtract" &&
        code !== "Numpad0"
      )
        return;
      event.preventDefault();

      if (code === "Equal" || code === "NumpadAdd") {
        if (appMode === "notes") setEditorFontSize((prev) => Math.min(28, prev + 1));
        return;
      }
      if (code === "Minus" || code === "NumpadSubtract") {
        if (appMode === "notes") setEditorFontSize((prev) => Math.max(12, prev - 1));
        return;
      }
      if (code === "Digit0" || code === "Numpad0") {
        if (appMode === "notes") setEditorFontSize(14);
        return;
      }
      if (code === "KeyN") {
        void createNewNote();
        return;
      }
      if (code === "KeyT") {
        const currentPane = getFocusedPane();
        setSidebarCollapsed((prev) => {
          const next = !prev;
          if (next) {
            if (currentPane === "folders" || currentPane === "middle")
              lastLeftPaneFocusRef.current = currentPane;
            requestAnimationFrame(() => focusPane("right"));
          } else {
            requestAnimationFrame(() => focusPane(lastLeftPaneFocusRef.current));
          }
          return next;
        });
        return;
      }
      if (code === "KeyW") {
        if (sidebarCollapsed) {
          setSidebarCollapsed(false);
          requestAnimationFrame(() => focusPane(lastLeftPaneFocusRef.current));
          return;
        }
        const currentPane = getFocusedPane();
        const targetPane: "folders" | "middle" =
          currentPane === "folders" ? "middle" : "folders";
        lastLeftPaneFocusRef.current = targetPane;
        focusPane(targetPane);
        return;
      }

      const panes: PaneId[] = sidebarCollapsed
        ? ["right"]
        : ["folders", "middle", "right"];
      const currentPane = getFocusedPane();
      const startPane =
        currentPane && panes.includes(currentPane) ? currentPane : "middle";
      const delta = code === "KeyK" ? 1 : -1;
      const nextIndex = Math.max(
        0,
        Math.min(panes.length - 1, panes.indexOf(startPane) + delta)
      );
      const targetPane = panes[nextIndex];
      if (targetPane === "folders" || targetPane === "middle")
        lastLeftPaneFocusRef.current = targetPane;
      focusPane(targetPane);
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [appMode, createNewNote, sidebarCollapsed]);

  const handleNotesKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      if ((event.metaKey || event.ctrlKey) && event.key === "ArrowLeft") {
        event.preventDefault();
        lastLeftPaneFocusRef.current = "folders";
        focusNoScroll(foldersPanelRef.current);
      }
      return;
    }
    if (!activeNode || notes.length === 0) return;
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
  };

  const handleFoldersKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "ArrowRight") {
      event.preventDefault();
      lastLeftPaneFocusRef.current = "middle";
      focusNoScroll(middlePaneRef.current);
      return;
    }
    if (
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown" &&
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight"
    )
      return;
    if (visibleItems.length === 0) return;
    event.preventDefault();

    const current =
      lastSelectedFolder && orderedIds.includes(lastSelectedFolder)
        ? lastSelectedFolder
        : activeFolder || orderedIds[0];
    const currentIndex = orderedIds.indexOf(current);
    const currentItem = flatItems.find((item) => item.id === current);
    const parentId = currentItem?.parentId ?? null;
    const hasChildren = currentItem ? currentItem.children.length > 0 : false;
    const isExpanded = current ? expanded.has(current) : false;

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const delta = event.key === "ArrowUp" ? -1 : 1;
      const nextIndex = Math.max(
        0,
        Math.min(orderedIds.length - 1, currentIndex + delta)
      );
      const nextPath = orderedIds[nextIndex];
      setSelectedFolders(new Set([nextPath]));
      setLastSelectedFolder(nextPath);
      setActiveFolder(nextPath);
      setSelectedNotes(new Set());
      setActiveNote(null);
      requestAnimationFrame(() => {
        scrollIntoViewIfNeeded(
          foldersPanelRef.current,
          `[data-folder="${escapeSelectorValue(nextPath)}"]`
        );
      });
      return;
    }

    if (event.key === "ArrowRight") {
      if (currentItem && hasChildren) {
        if (!isExpanded) {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.add(currentItem.id);
            return next;
          });
          return;
        }
        const firstChild = currentItem.children[0];
        if (firstChild) {
          setSelectedFolders(new Set([firstChild.id]));
          setLastSelectedFolder(firstChild.id);
          setActiveFolder(firstChild.id);
          setSelectedNotes(new Set());
          setActiveNote(null);
          requestAnimationFrame(() => {
            scrollIntoViewIfNeeded(
              foldersPanelRef.current,
              `[data-folder="${escapeSelectorValue(firstChild.id)}"]`
            );
          });
        }
      }
      return;
    }

    if (event.key === "ArrowLeft") {
      if (currentItem && hasChildren && isExpanded) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(currentItem.id);
          return next;
        });
        return;
      }
      if (parentId) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(parentId);
          return next;
        });
        setSelectedFolders(new Set([parentId]));
        setLastSelectedFolder(parentId);
        setActiveFolder(parentId);
        setSelectedNotes(new Set());
        setActiveNote(null);
        requestAnimationFrame(() => {
          scrollIntoViewIfNeeded(
            foldersPanelRef.current,
            `[data-folder="${escapeSelectorValue(parentId)}"]`
          );
        });
      }
    }
  };

  // -- Render helpers -------------------------------------------------------
  const renderMiddlePane = () =>
    appMode === "notes" ? (
      <div className="pane notes-pane min-w-0">
        <div className="pane-drag-region" data-tauri-drag-region aria-hidden />
        <div
          className="pane-body focus:outline-none"
          ref={(node) => {
            notesPanelRef.current = node;
            middlePaneRef.current = node;
          }}
          tabIndex={0}
          onKeyDown={handleNotesKeyDown}
          onClick={() => {
            lastLeftPaneFocusRef.current = "middle";
            focusNoScroll(middlePaneRef.current);
          }}
        >
          {notes.length === 0 && <div className="empty">No notes</div>}
          <SortableContext
            items={notes.map((n) => n.path)}
            strategy={verticalListSortingStrategy}
          >
            {notes.map((note) => (
              <NoteRow
                key={note.path}
                note={note}
                preview={notePreviews[note.path]}
                isSelected={selectedNotes.has(note.path)}
                onClick={handleNoteClick}
                onContextMenu={handleNoteContextMenu}
              />
            ))}
          </SortableContext>
        </div>
      </div>
    ) : (
      <SettingsMiddlePane
        activeSection={activeSettingsSection}
        onSectionChange={setActiveSettingsSection}
        middlePaneRef={middlePaneRef}
        onPaneClick={() => {
          lastLeftPaneFocusRef.current = "middle";
          focusNoScroll(middlePaneRef.current);
        }}
      />
    );

  const renderRightPane = () =>
    appMode === "notes" ? (
      <div className="pane editor-pane min-w-0">
        <div
          className="pane-body editor-body"
          ref={rightPaneRef}
          tabIndex={0}
          onClick={() => {
            const editorElement =
              rightPaneRef.current?.querySelector<HTMLElement>(
                ".tiptap-content[contenteditable='true']"
              ) || rightPaneRef.current;
            focusNoScroll(editorElement);
          }}
        >
          <div className="editor-single">
            <NoteEditor
              markdown={activeNote ? noteContent : draftNoteContent}
              onChange={handleEditorChange}
            />
          </div>
        </div>
      </div>
    ) : (
      <SettingsDetailPane
        activeSection={activeSettingsSection}
        theme={theme}
        onThemeChange={setTheme}
        rightPaneRef={rightPaneRef}
        onPaneClick={() => focusNoScroll(rightPaneRef.current)}
      />
    );

  const renderLeftPane = () => (
    <div className="pane-with-drag">
      <div className="pane-drag-region" data-tauri-drag-region aria-hidden />
      <FoldersPanel
        treeData={treeData}
        selectedIds={selectedFolders}
        onSelect={handleFolderClick}
        edgeSnap={edgeSnap}
        expanded={expanded}
        onToggle={handleToggle}
        onPaneKeyDown={handleFoldersKeyDown}
        onPaneClick={() => {
          lastLeftPaneFocusRef.current = "folders";
          focusNoScroll(foldersPanelRef.current);
        }}
        paneBodyRef={foldersPanelRef}
        onClearSelection={() => {
          setSelectedFolders(new Set());
          setLastSelectedFolder("");
        }}
        renamingFolder={renamingFolder}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
        submitRenameFolder={submitRenameFolder}
        cancelRenameFolder={() => {
          setRenamingFolder(null);
          setRenameValue("");
        }}
        onContextMenu={handleFolderContextMenu}
        indentationWidth={indentationWidth}
        sectionTitle="Folders"
        topAction={
          <button
            type="button"
            className="nav-action nav-action-new rounded-xl px-3 py-2 transition-colors"
            onClick={(event) => {
              event.stopPropagation();
              void createNewNote();
            }}
          >
            <span className="nav-action-icon" aria-hidden>
              +
            </span>
            <span>New note</span>
          </button>
        }
        footer={
          <button
            type="button"
            className={`nav-action nav-action-settings rounded-xl px-3 py-2 transition-colors${
              appMode === "settings" ? " active" : ""
            }`}
            onClick={(event) => {
              event.stopPropagation();
              setAppMode((prev) => (prev === "notes" ? "settings" : "notes"));
            }}
          >
            <span className="nav-action-icon text-base leading-none" aria-hidden>
              {appMode === "settings" ? (
                "←"
              ) : (
                <Settings className="h-4 w-4 shrink-0" strokeWidth={1.9} />
              )}
            </span>
            <span>{appMode === "settings" ? "Back to notes" : "Settings"}</span>
          </button>
        }
      />
    </div>
  );

  // -- Main render ----------------------------------------------------------
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className={`window-shell theme-${theme}`}>
        <div
          className={`app theme-${theme}${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
          style={appStyle}
        >
          <button
            type="button"
            className="sidebar-toggle-btn"
            aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            onClick={() => setSidebarCollapsed((prev) => !prev)}
          >
            <svg viewBox="0 0 16 16" aria-hidden>
              <rect
                x="1.25"
                y="1.75"
                width="13.5"
                height="12.5"
                rx="3.25"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
              />
              <path
                d="M5.8 2.9v10.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
              />
            </svg>
          </button>
          {sidebarCollapsed ? (
            <div className="app-single-pane">{renderRightPane()}</div>
          ) : (
            <ResizablePanelGroup
              orientation="horizontal"
              className="app-panels"
              defaultLayout={panelLayout}
              onLayoutChanged={(layout) => setPanelLayout(layout)}
            >
              <ResizablePanel
                id="nav"
                defaultSize="22%"
                minSize="16%"
                maxSize="34%"
                className="min-w-0 h-full min-h-0"
              >
                {renderLeftPane()}
              </ResizablePanel>
              <ResizableHandle className="app-resize-handle" />
              <ResizablePanel
                id="middle"
                defaultSize="25%"
                minSize="18%"
                maxSize="40%"
                className="min-w-0 h-full min-h-0"
              >
                {renderMiddlePane()}
              </ResizablePanel>
              <ResizableHandle className="app-resize-handle app-resize-handle-editor" />
              <ResizablePanel
                id="content"
                defaultSize="53%"
                minSize="30%"
                className="min-w-0 h-full min-h-0"
              >
                {renderRightPane()}
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </div>
      </div>
      <DragOverlay modifiers={[snapCenterToCursor]}>
        {activeId ? (
          <div className="drag-ghost">{activeId.split("/").pop() || activeId}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export default App;
