import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
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
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu } from "@tauri-apps/api/menu";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import "./App.css";
import { DROP_PREFIX, ROOT_ID, FoldersPanel } from "./components/FoldersPanel";
import { NoteEditor } from "./components/NoteEditor";
import type { DragData, FolderNode, NoteEntry, NoteMeta } from "./types";
import type { TreeItem } from "./tree/types";
import { flattenTree, removeChildrenOf } from "./tree/utilities";

const indentationWidth = 18;
const LOG_PREFIX = "[notes]";

type NotePreview = {
  title: string;
  dateLabel: string;
  secondLine: string;
};

type AppMode = "notes" | "settings";
type ThemeMode = "light" | "dark";

type SettingsSectionId =
  | "general"
  | "appearance"
  | "editor"
  | "sync"
  | "privacy"
  | "about";

type SettingsSection = {
  id: SettingsSectionId;
  title: string;
  description: string;
};

const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "general", title: "General", description: "Basic app behavior and defaults." },
  { id: "appearance", title: "Appearance", description: "Typography, spacing, and theme accents." },
  { id: "editor", title: "Editor", description: "Editing, autosave, and preview behavior." },
  { id: "sync", title: "Sync", description: "Cloud sync, refresh policy, and conflict rules." },
  { id: "privacy", title: "Privacy", description: "Data collection and local-only controls." },
  { id: "about", title: "About", description: "Version, diagnostics, and support links." },
];

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

const logGroup = (label: string, data?: Record<string, unknown>) => {
  console.groupCollapsed(`${LOG_PREFIX} ${label}`);
  if (data) {
    console.log(data);
  }
  console.groupEnd();
};

const invokeLogged = async <T,>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> => {
  console.groupCollapsed(`${LOG_PREFIX} invoke ${command}`);
  if (args) {
    console.log("args", args);
  }
  try {
    const result = await invoke<T>(command, args);
    console.log("result", result);
    console.groupEnd();
    return result;
  } catch (error) {
    console.error("error", error);
    console.groupEnd();
    throw error;
  }
};

const focusNoScroll = (el: HTMLElement | null) => {
  if (!el) {
    return;
  }
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
};

const scrollIntoViewIfNeeded = (container: HTMLElement | null, selector: string) => {
  if (!container) {
    return;
  }
  const target = container.querySelector<HTMLElement>(selector);
  if (target) {
    target.scrollIntoView({ block: "nearest" });
  }
};

const escapeSelectorValue = (value: string) => {
  if (typeof window !== "undefined" && window.CSS?.escape) {
    return window.CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
};

const confirmAction = async (message: string) => {
  try {
    const result = window.confirm(message);
    console.log("[confirm] window", message, result);
    return result;
  } catch (error) {
    console.warn("[confirm] window failed, falling back", error);
  }
  try {
    const result = await confirmDialog(message);
    console.log("[confirm] dialog", message, result);
    return Boolean(result);
  } catch (error) {
    console.error("[confirm] dialog failed", error);
    return false;
  }
};

function buildTreeItems(node: FolderNode): TreeItem[] {
  return node.children.map((child) => ({
    id: child.path,
    name: child.name,
    noteCount: child.notes.length,
    children: buildTreeItems(child),
  }));
}

type FlatNode = { id: string; name: string; parentId: string | null; depth: number };

const flattenTreeData = (
  nodes: TreeItem[],
  parentId: string | null = null,
  depth = 0,
  acc: FlatNode[] = []
) => {
  nodes.forEach((node) => {
    acc.push({ id: node.id, name: node.name, parentId, depth });
    if (node.children && node.children.length > 0) {
      flattenTreeData(node.children, node.id, depth + 1, acc);
    }
  });
  return acc;
};

const arraysEqual = (a: string[] | undefined, b: string[] | undefined) => {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
};

const buildFolderOrderMap = (nodes: TreeItem[], parentId: string | null, map: Record<string, string[]>) => {
  map[parentId ?? ""] = nodes.map((node) => node.id.split("/").pop() || node.id);
  nodes.forEach((node) => buildFolderOrderMap(node.children, node.id, map));
};

const applyFolderOrder = (node: FolderNode, orderMap: Record<string, string[]>): FolderNode => {
  const key = node.path || "";
  const order = orderMap[key];
  let children = node.children;
  if (order && order.length > 0) {
    const index = new Map(order.map((name, idx) => [name, idx]));
    children = [...children].sort((a, b) => {
      const ai = index.get(a.name);
      const bi = index.get(b.name);
      if (ai == null && bi == null) {
        return a.name.localeCompare(b.name);
      }
      if (ai == null) {
        return 1;
      }
      if (bi == null) {
        return -1;
      }
      return ai - bi;
    });
  }
  return {
    ...node,
    children: children.map((child) => applyFolderOrder(child, orderMap)),
  };
};

const findParentAndIndex = (
  nodes: TreeItem[],
  id: string,
  parentId: string | null = null
): { parentId: string | null; index: number } | null => {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.id === id) {
      return { parentId, index };
    }
    if (node.children && node.children.length > 0) {
      const result = findParentAndIndex(node.children, id, node.id);
      if (result) {
        return result;
      }
    }
  }
  return null;
};

const getNodeById = (nodes: TreeItem[], id: string): TreeItem | null => {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    if (node.children && node.children.length > 0) {
      const found = getNodeById(node.children, id);
      if (found) {
        return found;
      }
    }
  }
  return null;
};

const removeNodes = (nodes: TreeItem[], ids: string[]) => {
  const idSet = new Set(ids);
  const removed: TreeItem[] = [];

  const walk = (list: TreeItem[]) => {
    const next: TreeItem[] = [];
    list.forEach((node) => {
      if (idSet.has(node.id)) {
        removed.push(node);
        return;
      }
      let children = node.children || [];
      if (children.length > 0) {
        const updatedChildren = walk(children);
        if (updatedChildren !== children) {
          children = updatedChildren;
        }
      }
      if (children !== node.children) {
        next.push({ ...node, children });
      } else {
        next.push(node);
      }
    });
    return next;
  };

  return { tree: walk(nodes), removed };
};

const insertNodes = (
  nodes: TreeItem[],
  parentId: string | null,
  index: number,
  items: TreeItem[]
): TreeItem[] => {
  if (parentId === null) {
    const before = nodes.slice(0, index);
    const after = nodes.slice(index);
    return [...before, ...items, ...after];
  }

  let changed = false;
  const next = nodes.map((node) => {
    if (node.id === parentId) {
      changed = true;
      const children = node.children ? [...node.children] : [];
      const before = children.slice(0, index);
      const after = children.slice(index);
      return { ...node, children: [...before, ...items, ...after] };
    }
    if (node.children && node.children.length > 0) {
      const updatedChildren = insertNodes(node.children, parentId, index, items);
      if (updatedChildren !== node.children) {
        changed = true;
        return { ...node, children: updatedChildren };
      }
    }
    return node;
  });

  return changed ? next : nodes;
};

type DropTarget =
  | { type: "root"; position: "inside" }
  | { type: "item"; itemId: string; position: "inside" | "before" | "after" };

const parseDropTargetId = (id: string | number | null): DropTarget | null => {
  if (typeof id !== "string") {
    return null;
  }
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== DROP_PREFIX) {
    return null;
  }
  const itemId = parts[1];
  const position = parts[2];
  if (!itemId || !position || (position !== "inside" && position !== "before" && position !== "after")) {
    return null;
  }
  if (itemId === ROOT_ID) {
    return position === "inside" ? { type: "root", position } : null;
  }
  return { type: "item", itemId, position };
};

const sortIdsByTreeOrder = (ids: string[], orderedIds: string[]) => {
  const orderIndex = new Map<string, number>();
  orderedIds.forEach((id, index) => {
    orderIndex.set(id, index);
  });
  return ids.slice().sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
};

const isDescendantOf = (nodes: TreeItem[], ancestorId: string, targetId: string) => {
  const ancestor = getNodeById(nodes, ancestorId);
  if (!ancestor || !ancestor.children || ancestor.children.length === 0) {
    return false;
  }
  const stack = [...ancestor.children];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current?.id === targetId) {
      return true;
    }
    if (current?.children && current.children.length > 0) {
      stack.push(...current.children);
    }
  }
  return false;
};

const isInDraggedSubtree = (nodes: TreeItem[], draggedIds: string[], targetId: string) => {
  return draggedIds.some(
    (draggedId) => draggedId === targetId || isDescendantOf(nodes, draggedId, targetId)
  );
};

const getTopLevelSelected = (selectedIds: string[], parentById: Record<string, string | null>) => {
  const selectedSet = new Set(selectedIds);
  return selectedIds.filter((id) => {
    let parent = parentById[id];
    while (parent) {
      if (selectedSet.has(parent)) {
        return false;
      }
      parent = parentById[parent];
    }
    return true;
  });
};

function findNode(node: FolderNode | null, path: string): FolderNode | null {
  if (!node) {
    return null;
  }
  if (node.path === path) {
    return node;
  }
  for (const child of node.children) {
    const match = findNode(child, path);
    if (match) {
      return match;
    }
  }
  return null;
}

function reorderList(list: string[], moving: string[], target: string) {
  const movingSet = new Set(moving);
  const remaining = list.filter((item) => !movingSet.has(item));
  let targetIndex = remaining.indexOf(target);
  if (targetIndex === -1) {
    targetIndex = remaining.length;
  }
  return [
    ...remaining.slice(0, targetIndex),
    ...moving,
    ...remaining.slice(targetIndex),
  ];
}

const formatNoteDateLabel = (timestamp: number | null) => {
  if (!timestamp) {
    return "";
  }
  const value = new Date(timestamp);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemStart = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const diffDays = Math.floor((todayStart.getTime() - itemStart.getTime()) / 86_400_000);
  if (diffDays <= 0) {
    return value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (diffDays === 1) {
    return "yesterday";
  }
  if (diffDays < 7) {
    return value.toLocaleDateString([], { weekday: "long" }).toLowerCase();
  }
  return value.toLocaleDateString([], { month: "numeric", day: "numeric", year: "2-digit" });
};

const parseNotePreview = (noteName: string, content: string, updatedMs: number | null): NotePreview => {
  const stripMarkdown = (line: string) =>
    line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[>\-+*]\s+/, "")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_~`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const lines = content.split(/\r?\n/);
  const fallbackTitle = noteName.replace(/\.md$/i, "");
  const title = stripMarkdown(lines[0] || "") || fallbackTitle;
  const secondLine = stripMarkdown(lines[1] || "");
  return { title, dateLabel: formatNoteDateLabel(updatedMs), secondLine };
};

function App() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>("notes");
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>("general");
  const [tree, setTree] = useState<FolderNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [lastSelectedFolder, setLastSelectedFolder] = useState<string>("");
  const [activeFolder, setActiveFolder] = useState<string>("");
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
  const [lastSelectedNote, setLastSelectedNote] = useState<string>("");
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState<string>("");
  const [draftNoteContent, setDraftNoteContent] = useState<string>("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [notePreviews, setNotePreviews] = useState<Record<string, NotePreview>>({});
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [edgeSnap, setEdgeSnap] = useState<{ id: string; position: "before" | "after" } | null>(
    null
  );
  const activeDrag = useRef<DragData | null>(null);
  const saveTimer = useRef<number | null>(null);
  const dragStartPoint = useRef<{ x: number; y: number } | null>(null);
  const expandTimeoutRef = useRef<number | null>(null);
  const expandTargetRef = useRef<string | null>(null);
  const notesPanelRef = useRef<HTMLDivElement | null>(null);
  const foldersPanelRef = useRef<HTMLDivElement | null>(null);
  const folderContextPathRef = useRef<string | null>(null);
  const noteContextPathRef = useRef<string | null>(null);
  const selectedFoldersRef = useRef<Set<string>>(new Set());
  const selectedNotesRef = useRef<Set<string>>(new Set());
  const folderMenuPromiseRef = useRef<Promise<Menu> | null>(null);
  const noteMenuPromiseRef = useRef<Promise<Menu> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  useEffect(() => {
    console.log("[folders] selectedFolders", Array.from(selectedFolders));
    selectedFoldersRef.current = selectedFolders;
  }, [selectedFolders]);

  useEffect(() => {
    window.localStorage.setItem("notes-viewer-theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    console.log("[folders] activeFolder", activeFolder);
  }, [activeFolder]);

  useEffect(() => {
    selectedNotesRef.current = selectedNotes;
  }, [selectedNotes]);

  const refreshTree = async () => {
    const data = await invokeLogged<FolderNode>("get_tree");
    setTree(data);
  };

  useEffect(() => {
    refreshTree();
  }, []);

  const treeData = useMemo(() => {
    if (!tree) {
      return [] as TreeItem[];
    }
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

  const activeNode = useMemo(() => {
    return findNode(tree, activeFolder);
  }, [tree, activeFolder]);

  useEffect(() => {
    console.log("[folders] activeNode", activeNode?.path || null);
  }, [activeNode]);

  useEffect(() => {
    if (!activeNote) {
      setNoteDirty(false);
      return;
    }
    let cancelled = false;
    invokeLogged<string>("read_note", { path: activeNote }).then((content) => {
      if (!cancelled) {
        setNoteContent(content);
        setNoteDirty(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeNote]);

  const handleEditorChange = (markdown: string) => {
    if (!activeNote) {
      setDraftNoteContent((prev) => {
        if (prev === markdown) {
          return prev;
        }
        return markdown;
      });
      return;
    }
    setNoteContent((prev) => {
      if (prev === markdown) {
        return prev;
      }
      return markdown;
    });
    setNoteDirty(true);
  };

  useEffect(() => {
    if (!activeNote || !noteDirty) {
      return;
    }
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }
    saveTimer.current = window.setTimeout(() => {
      invokeLogged("write_note", { path: activeNote, content: noteContent }).then(() => {
        setNoteDirty(false);
      });
    }, 400);
    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }
    };
  }, [activeNote, noteContent, noteDirty]);

  const handleFolderClick = (event: ReactMouseEvent, path: string) => {
    event.stopPropagation();
    console.log("[folders] onSelect handler", path);
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
      if (nextSelected.has(path)) {
        nextSelected.delete(path);
      } else {
        nextSelected.add(path);
      }
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

  const handleNoteClick = (notePath: string, event: ReactMouseEvent) => {
    if (!activeNode) {
      return;
    }
    const notePaths = activeNode.notes.map((note) => note.path);
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
      if (nextSelected.has(notePath)) {
        nextSelected.delete(notePath);
      } else {
        nextSelected.add(notePath);
      }
    } else {
      nextSelected.clear();
      nextSelected.add(notePath);
    }
    setSelectedNotes(nextSelected);
    setLastSelectedNote(notePath);
    setActiveNote(notePath);
  };

  const handleToggle = (event: ReactMouseEvent, id: string) => {
    event.stopPropagation();
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const buildNoteOrderMap = (node: FolderNode | null, map: Record<string, string[]>) => {
    if (!node) {
      return;
    }
    map[node.path] = node.notes.map((note) => note.name);
    node.children.forEach((child) => buildNoteOrderMap(child, map));
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
    const newPath = await invokeLogged<string>("rename_item", {
      path: renamingFolder,
      newName: renameValue.trim(),
    });
    setRenamingFolder(null);
    setRenameValue("");
    await refreshTree();
    if (wasActive) {
      setActiveFolder(newPath);
    }
    if (wasSelected) {
      const nextSelected = new Set(selectedFolders);
      nextSelected.delete(renamingFolder);
      nextSelected.add(newPath);
      setSelectedFolders(nextSelected);
      setLastSelectedFolder(newPath);
    }
  };

  const deleteFolders = async (paths: string[]) => {
    if (paths.length === 0) {
      return;
    }
    console.log("[folders] deleteFolders", paths);
    const confirmed = await confirmAction(`Delete ${paths.length} folder(s)?`);
    if (!confirmed) {
      return;
    }
    await invokeLogged("delete_items", { items: paths });
    setSelectedFolders(new Set());
    if (paths.includes(activeFolder)) {
      setActiveFolder("");
    }
    await refreshTree();
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
              if (!path) {
                return;
              }
              startRenameFolder(path);
            },
          },
          {
            id: "folder.delete",
            text: "Delete folder",
            action: () => {
              const path = folderContextPathRef.current;
              if (!path) {
                return;
              }
              const selected = selectedFoldersRef.current;
              const paths =
                selected.size > 1 && selected.has(path) ? Array.from(selected) : [path];
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

  const showNoteInfo = async (path: string) => {
    try {
      const meta = await invokeLogged<NoteMeta>("get_note_meta", { path });
      const createdLabel = meta.created_ms ? new Date(meta.created_ms).toLocaleString() : "—";
      const updatedLabel = meta.updated_ms ? new Date(meta.updated_ms).toLocaleString() : "—";
      window.alert(`Created: ${createdLabel}\nUpdated: ${updatedLabel}`);
    } catch (error) {
      console.error("[notes] failed to show note info", error);
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
              if (!path) {
                return;
              }
              void showNoteInfo(path);
            },
          },
          {
            id: "note.delete",
            text: "Delete selected",
            action: () => {
              const path = noteContextPathRef.current;
              if (!path) {
                return;
              }
              const selected = selectedNotesRef.current;
              const paths =
                selected.size > 1 && selected.has(path) ? Array.from(selected) : [path];
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

  const deleteNotes = async (paths: string[]) => {
    if (paths.length === 0) {
      return;
    }
    const confirmed = await confirmAction(`Delete ${paths.length} note(s)?`);
    if (!confirmed) {
      return;
    }
    await invokeLogged("delete_items", { items: paths });
    setSelectedNotes(new Set());
    if (paths.includes(activeNote || "")) {
      setActiveNote(null);
      setNoteContent("");
    }
    await refreshTree();
  };

  const handleDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const data = active.data.current as DragData | undefined;
    if (!data) {
      return;
    }
    activeDrag.current = data;
    logGroup("drag start", {
      type: data.type,
      path: "path" in data ? data.path : undefined,
      id: active.id.toString(),
    });
    if (data.type === "folder") {
      const point =
        activatorEvent instanceof globalThis.MouseEvent
          ? {
              x: activatorEvent.clientX,
              y: activatorEvent.clientY,
            }
          : null;
      dragStartPoint.current = point;
      setActiveId(active.id.toString());
      setSelectedFolders((prev) => {
        if (prev.has(data.path)) {
          return prev;
        }
        return new Set([data.path]);
      });
      setLastSelectedFolder(data.path);
      document.body.style.setProperty("cursor", "grabbing");
    }
    if (data.type === "note") {
      setSelectedNotes((prev) => {
        if (prev.has(data.path)) {
          return prev;
        }
        return new Set([data.path]);
      });
      setLastSelectedNote(data.path);
      setActiveNote(data.path);
    }
  };

  const handleDragMove = (event: DragMoveEvent) => {
    if (activeDrag.current?.type !== "folder") {
      return;
    }
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
        if (expandTimeoutRef.current) {
          window.clearTimeout(expandTimeoutRef.current);
        }
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
      if (activeRect) {
        pointerY = activeRect.top + activeRect.height / 2;
      }
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
    if (activeDrag.current?.type !== "folder") {
      return;
    }
    if (!event.over) {
      setEdgeSnap(null);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    const data = active.data.current as DragData | undefined;
    const overData = over?.data.current as DragData | undefined;

    if (!data) {
      return;
    }

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

      if (!over) {
        return;
      }

      const resolvedId =
        edgeSnap ? `${DROP_PREFIX}:${edgeSnap.id}:${edgeSnap.position}` : over.id;
      const dropTarget = parseDropTargetId(resolvedId);
      if (!dropTarget) {
        logGroup("drop ignored", { reason: "invalid target", overId: over.id });
        return;
      }

      const selectedIdsList = Array.from(selectedFolders);
      const draggingIds = getTopLevelSelected(selectedIdsList, parentById);
      if (draggingIds.length === 0) {
        logGroup("drop ignored", { reason: "no dragging ids" });
        return;
      }

      if (dropTarget.type === "item" && draggingIds.includes(dropTarget.itemId)) {
        logGroup("drop ignored", { reason: "target is dragged item", target: dropTarget });
        return;
      }

      if (
        dropTarget.type === "item" &&
        isInDraggedSubtree(treeData, draggingIds, dropTarget.itemId)
      ) {
        logGroup("drop ignored", { reason: "target inside dragged subtree", target: dropTarget });
        return;
      }

      const orderedDraggingIds = sortIdsByTreeOrder(draggingIds, orderedIds);
      const { tree: prunedTree, removed } = removeNodes(treeData, orderedDraggingIds);
      const removedMap = new Map(removed.map((node) => [node.id, node]));
      const nodesToInsert = orderedDraggingIds
        .map((id) => removedMap.get(id))
        .filter(Boolean) as TreeItem[];

      if (nodesToInsert.length === 0) {
        return;
      }

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
        if (!position) {
          return;
        }
        targetParentId = position.parentId;
        targetIndex = position.index + (dropTarget.position === "after" ? 1 : 0);
      }

      const nextTree = insertNodes(prunedTree, targetParentId, targetIndex, nodesToInsert);
      logGroup("folder drag drop", {
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
          await invokeLogged("move_items", {
            items: [id],
            destination: newParent ?? "",
          });
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

      logGroup("folder order delta", {
        changedParents,
        totalParents: Object.keys(nextOrderMap).length,
      });

      for (const parentPath of changedParents) {
        await invokeLogged("set_order", {
          args: {
            parent: parentPath,
            folderOrder: nextOrderMap[parentPath],
            noteOrder: noteOrderMap[parentPath] || [],
          },
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
        logGroup("note drop ignored", { reason: "missing target" });
        return;
      }
      const selectedList = selectedNotes.has(data.path)
        ? Array.from(selectedNotes)
        : [data.path];
      if (overData.type === "folder") {
        logGroup("note move to folder", {
          notes: selectedList,
          destination: overData.path,
        });
        await invokeLogged("move_items", { items: selectedList, destination: overData.path });
        if (selectedList.includes(activeNote || "")) {
          setActiveNote(null);
          setNoteContent("");
        }
        setSelectedNotes(new Set());
        await refreshTree();
        return;
      }
      if (overData.type === "note" && activeNode) {
        if (selectedList.includes(overData.path)) {
          return;
        }
        const notePaths = activeNode.notes.map((note) => note.path);
        const newOrder = reorderList(notePaths, selectedList, overData.path);
        const folderOrder = activeNode.children.map((child) => child.name);
        const noteOrder = newOrder.map((path) => path.split("/").pop() || path);
        logGroup("note reorder", {
          parent: activeNode.path,
          dragging: selectedList,
          over: overData.path,
          noteOrder,
          folderOrder,
        });
        await invokeLogged("set_order", {
          args: {
            parent: activeNode.path,
            folderOrder: folderOrder,
            noteOrder: noteOrder,
          },
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

  const NoteRow = ({ note, preview }: { note: NoteEntry; preview?: NotePreview }) => {
    const isSelected = selectedNotes.has(note.path);
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
      useSortable({
        id: note.path,
        data: { type: "note", path: note.path } satisfies DragData,
      });

    const style: React.CSSProperties = {
      transform: !isDragging ? DndCSS.Transform.toString(transform) : undefined,
      transition: !isDragging ? transition : undefined,
    };

    return (
      <div
        ref={setNodeRef}
        className={`item-row note-row transition-colors ${isSelected ? "selected" : ""}`}
        style={style}
        data-note={note.path}
        onClick={(event) => handleNoteClick(note.path, event)}
        onContextMenu={(event) => void handleNoteContextMenu(event, note.path)}
        {...attributes}
        {...listeners}
      >
        <div className="note-row-main">
          <div className="note-row-title">{preview?.title || note.name.replace(/\.md$/i, "")}</div>
          <div className="note-row-subline">
            <span className="note-row-date">{preview?.dateLabel || ""}</span>
            {preview?.dateLabel && preview?.secondLine && <span className="note-row-dot"> </span>}
            <span className="note-row-snippet">{preview?.secondLine || ""}</span>
          </div>
        </div>
      </div>
    );
  };

  const SettingsRow = ({ section }: { section: SettingsSection }) => {
    const isSelected = activeSettingsSection === section.id;
    return (
      <button
        type="button"
        className={`item-row settings-row transition-colors${isSelected ? " selected" : ""}`}
        onClick={() => setActiveSettingsSection(section.id)}
      >
        <div className="settings-row-main">
          <div className="settings-row-title">{section.title}</div>
          <div className="settings-row-subline">{section.description}</div>
        </div>
      </button>
    );
  };

  const renderSettingsDetail = () => {
    if (activeSettingsSection === "general") {
      return (
        <>
          <h2 className="settings-detail-title">General</h2>
          <p className="settings-detail-text">Default behavior and opening workflow.</p>
          <label className="settings-control">
            <span>Start in folder</span>
            <select defaultValue="last">
              <option value="last">Last opened</option>
              <option value="inbox">Inbox</option>
              <option value="none">No auto-open</option>
            </select>
          </label>
          <label className="settings-control settings-toggle">
            <input type="checkbox" defaultChecked />
            <span>Auto-focus first note in selected folder</span>
          </label>
        </>
      );
    }
    if (activeSettingsSection === "appearance") {
      return (
        <>
          <h2 className="settings-detail-title">Appearance</h2>
          <p className="settings-detail-text">Visual style options (dummy).</p>
          <label className="settings-control">
            <span>Theme</span>
            <select value={theme} onChange={(event) => setTheme(event.target.value as ThemeMode)}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <label className="settings-control">
            <span>UI density</span>
            <select defaultValue="comfortable">
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
              <option value="spacious">Spacious</option>
            </select>
          </label>
          <label className="settings-control">
            <span>Accent intensity</span>
            <input type="range" min="0" max="100" defaultValue="45" />
          </label>
          <label className="settings-control settings-toggle">
            <input type="checkbox" defaultChecked />
            <span>Show subtle separators in lists</span>
          </label>
        </>
      );
    }
    if (activeSettingsSection === "editor") {
      return (
        <>
          <h2 className="settings-detail-title">Editor</h2>
          <p className="settings-detail-text">Editing and autosave behavior.</p>
          <label className="settings-control">
            <span>Autosave interval</span>
            <select defaultValue="400">
              <option value="250">250 ms</option>
              <option value="400">400 ms</option>
              <option value="1000">1 sec</option>
            </select>
          </label>
          <label className="settings-control settings-toggle">
            <input type="checkbox" defaultChecked />
            <span>Strip markdown in list previews</span>
          </label>
          <label className="settings-control settings-toggle">
            <input type="checkbox" />
            <span>Always open in markdown mode</span>
          </label>
        </>
      );
    }
    if (activeSettingsSection === "sync") {
      return (
        <>
          <h2 className="settings-detail-title">Sync</h2>
          <p className="settings-detail-text">Connection and refresh policy.</p>
          <label className="settings-control">
            <span>Sync provider</span>
            <select defaultValue="icloud">
              <option value="icloud">iCloud</option>
              <option value="local">Local filesystem</option>
              <option value="none">Disabled</option>
            </select>
          </label>
          <label className="settings-control settings-toggle">
            <input type="checkbox" defaultChecked />
            <span>Background refresh every 5 minutes</span>
          </label>
        </>
      );
    }
    if (activeSettingsSection === "privacy") {
      return (
        <>
          <h2 className="settings-detail-title">Privacy</h2>
          <p className="settings-detail-text">Telemetry and local diagnostics.</p>
          <label className="settings-control settings-toggle">
            <input type="checkbox" />
            <span>Send anonymous crash reports</span>
          </label>
          <label className="settings-control settings-toggle">
            <input type="checkbox" defaultChecked />
            <span>Keep all metadata local-only</span>
          </label>
        </>
      );
    }
    return (
      <>
        <h2 className="settings-detail-title">About</h2>
        <p className="settings-detail-text">Dummy system info for layout preview.</p>
        <div className="settings-info-grid">
          <div className="settings-info-row">
            <span>Version</span>
            <code>0.1.0-design</code>
          </div>
          <div className="settings-info-row">
            <span>Storage root</span>
            <code>~/notes</code>
          </div>
          <div className="settings-info-row">
            <span>Renderer</span>
            <code>Tauri + React</code>
          </div>
        </div>
      </>
    );
  };

  const notes = activeNode?.notes || [];

  useEffect(() => {
    if (notes.length === 0) {
      setNotePreviews({});
      return;
    }
    let cancelled = false;
    Promise.all(
      notes.map(async (note) => {
        const [meta, content] = await Promise.all([
          invokeLogged<NoteMeta>("get_note_meta", { path: note.path }),
          invokeLogged<string>("read_note", { path: note.path }),
        ]);
        const updatedMs = meta.updated_ms ?? meta.created_ms ?? null;
        return [note.path, parseNotePreview(note.name, content, updatedMs)] as const;
      })
    ).then((entries) => {
      if (cancelled) {
        return;
      }
      setNotePreviews(Object.fromEntries(entries));
    }).catch((error) => {
      console.error("[notes] failed to build previews", error);
    });
    return () => {
      cancelled = true;
    };
  }, [notes]);

  const handleNotesKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      if ((event.metaKey || event.ctrlKey) && event.key === "ArrowLeft") {
        event.preventDefault();
        foldersPanelRef.current?.focus();
      }
      return;
    }
    if (!activeNode || notes.length === 0) {
      return;
    }
    event.preventDefault();
    const notePaths = notes.map((note) => note.path);
    const current = lastSelectedNote && notePaths.includes(lastSelectedNote)
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
      scrollIntoViewIfNeeded(notesPanelRef.current, `[data-note="${escapeSelectorValue(nextPath)}"]`);
    });
  };

  const handleFoldersKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "ArrowRight") {
      event.preventDefault();
      focusNoScroll(notesPanelRef.current);
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown" && event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    if (visibleItems.length === 0) {
      return;
    }
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
      const nextIndex = Math.max(0, Math.min(orderedIds.length - 1, currentIndex + delta));
      const nextPath = orderedIds[nextIndex];
      setSelectedFolders(new Set([nextPath]));
      setLastSelectedFolder(nextPath);
      setActiveFolder(nextPath);
      setSelectedNotes(new Set());
      setActiveNote(null);
      requestAnimationFrame(() => {
        scrollIntoViewIfNeeded(foldersPanelRef.current, `[data-folder="${escapeSelectorValue(nextPath)}"]`);
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
          scrollIntoViewIfNeeded(foldersPanelRef.current, `[data-folder="${escapeSelectorValue(parentId)}"]`);
        });
      }
    }
  };

  const handleNewNoteNavigation = () => {
    if (appMode !== "notes") {
      setAppMode("notes");
    }
    focusNoScroll(notesPanelRef.current);
  };

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
        <div className={`app theme-${theme}${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
          <div className="left-panels-drag-region" data-tauri-drag-region aria-hidden />
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
              <path d="M5.8 2.9v10.2" fill="none" stroke="currentColor" strokeWidth="1.25" />
            </svg>
          </button>
          <FoldersPanel
            treeData={treeData}
            selectedIds={selectedFolders}
            onSelect={handleFolderClick}
            edgeSnap={edgeSnap}
            expanded={expanded}
            onToggle={handleToggle}
            onPaneKeyDown={handleFoldersKeyDown}
            onPaneClick={() => {
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
                  handleNewNoteNavigation();
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
                <span className="nav-action-icon" aria-hidden>
                  {appMode === "settings" ? "←" : "⚙"}
                </span>
                <span>{appMode === "settings" ? "Back to notes" : "Settings"}</span>
              </button>
            }
          />
          {appMode === "notes" ? (
            <div className="pane notes-pane min-w-0">
              <div
                className="pane-body focus:outline-none"
                ref={notesPanelRef}
                tabIndex={0}
                onKeyDown={handleNotesKeyDown}
                onClick={() => {
                  focusNoScroll(notesPanelRef.current);
                }}
              >
                {notes.length === 0 && <div className="empty">No notes</div>}
                <SortableContext
                  items={notes.map((note) => note.path)}
                  strategy={verticalListSortingStrategy}
                >
                  {notes.map((note) => (
                    <NoteRow key={note.path} note={note} preview={notePreviews[note.path]} />
                  ))}
                </SortableContext>
              </div>
            </div>
          ) : (
            <div className="pane settings-sections-pane min-w-0">
              <div className="pane-body settings-sections-body">
                {SETTINGS_SECTIONS.map((section) => (
                  <SettingsRow key={section.id} section={section} />
                ))}
              </div>
            </div>
          )}
          {appMode === "notes" ? (
            <div className="pane editor-pane min-w-0">
              <div className="pane-body editor-body">
                <div className="editor-single">
                  <NoteEditor
                    markdown={activeNote ? noteContent : draftNoteContent}
                    onChange={handleEditorChange}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="pane settings-detail-pane min-w-0">
              <div className="pane-body settings-detail-body">{renderSettingsDetail()}</div>
            </div>
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
