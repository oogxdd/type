import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type NoteEntry = {
  name: string;
  path: string;
};

type NoteMeta = {
  created_ms: number | null;
  updated_ms: number | null;
};

type FolderNode = {
  name: string;
  path: string;
  children: FolderNode[];
  notes: NoteEntry[];
};

type DragPayload = {
  kind: "folder" | "note";
  paths: string[];
};

type DragData = {
  kind: "folder" | "note";
  path: string;
};

const encodePath = (path: string) => encodeURIComponent(path);
const decodePath = (path: string) => decodeURIComponent(path);
const rowId = (kind: "folder" | "note", path: string) =>
  `${kind}-row|${encodePath(path)}`;
const dragId = (kind: "folder" | "note", path: string) =>
  `${kind}|${encodePath(path)}`;

type DropPosition = "before" | "after" | "inside";

type DropTarget = {
  kind: "folder" | "note";
  path: string;
  position: DropPosition;
};

type RowTarget = {
  kind: "folder" | "note";
  path: string;
};

function flattenVisibleFolders(
  node: FolderNode,
  expanded: Set<string>,
  acc: string[]
) {
  acc.push(node.path);
  if (!expanded.has(node.path)) {
    return;
  }
  node.children.forEach((child) => flattenVisibleFolders(child, expanded, acc));
}

function buildParentMap(
  node: FolderNode,
  parent: string | null,
  map: Map<string, string | null>,
  childrenMap: Map<string, string[]>
) {
  map.set(node.path, parent);
  childrenMap.set(
    node.path,
    node.children.map((child) => child.path)
  );
  node.children.forEach((child) => buildParentMap(child, node.path, map, childrenMap));
}

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

function isDescendant(parent: string, candidate: string) {
  return parent !== "" && (candidate === parent || candidate.startsWith(`${parent}/`));
}

function reorderList(
  list: string[],
  moving: string[],
  target: string,
  position: DropPosition
) {
  const movingSet = new Set(moving);
  const remaining = list.filter((item) => !movingSet.has(item));
  let targetIndex = remaining.indexOf(target);
  if (targetIndex === -1) {
    targetIndex = remaining.length;
  }
  const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
  return [
    ...remaining.slice(0, insertIndex),
    ...moving,
    ...remaining.slice(insertIndex),
  ];
}

function App() {
  const [tree, setTree] = useState<FolderNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [lastSelectedFolder, setLastSelectedFolder] = useState<string>("");
  const [activeFolder, setActiveFolder] = useState<string>("");
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
  const [lastSelectedNote, setLastSelectedNote] = useState<string>("");
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState<string>("");
  const [noteMeta, setNoteMeta] = useState<NoteMeta | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");
  const [draggingPayload, setDraggingPayload] = useState<DragPayload | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropTarget | null>(null);
  const draggingPayloadRef = useRef<DragPayload | null>(null);
  const [noteMenu, setNoteMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
  }>({ visible: false, x: 0, y: 0 });
  const saveTimer = useRef<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const refreshTree = async () => {
    const data = await invoke<FolderNode>("get_tree");
    setTree(data);
  };

  useEffect(() => {
    refreshTree();
  }, []);

  const visibleFolders = useMemo(() => {
    if (!tree) {
      return [];
    }
    const acc: string[] = [];
    flattenVisibleFolders(tree, expanded, acc);
    return acc;
  }, [tree, expanded]);

  const folderParentMap = useMemo(() => {
    const map = new Map<string, string | null>();
    const childrenMap = new Map<string, string[]>();
    if (tree) {
      buildParentMap(tree, null, map, childrenMap);
    }
    return { parent: map, children: childrenMap };
  }, [tree]);

  const activeNode = useMemo(() => {
    return findNode(tree, activeFolder);
  }, [tree, activeFolder]);

  useEffect(() => {
    if (!activeNote) {
      setNoteContent("");
      setNoteMeta(null);
      return;
    }
    let cancelled = false;
    invoke<string>("read_note", { path: activeNote }).then((content) => {
      if (!cancelled) {
        setNoteContent(content);
      }
    });
    invoke<NoteMeta>("get_note_meta", { path: activeNote }).then((meta) => {
      if (!cancelled) {
        setNoteMeta(meta);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeNote]);

  useEffect(() => {
    if (!activeNote) {
      return;
    }
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }
    saveTimer.current = window.setTimeout(() => {
      invoke("write_note", { path: activeNote, content: noteContent }).then(() => {
        setNoteMeta((prev) =>
          prev ? { ...prev, updated_ms: Date.now() } : prev
        );
      });
    }, 400);
    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }
    };
  }, [activeNote, noteContent]);

  const handleFolderClick = (path: string, event: MouseEvent) => {
    const nextSelected = new Set(selectedFolders);
    if (event.shiftKey && lastSelectedFolder) {
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

  const handleNoteClick = (notePath: string, event: MouseEvent) => {
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

  const handleFolderDrop = async (
    targetPath: string,
    position: DropPosition,
    payload: DragPayload
  ) => {
    if (!tree) {
      return;
    }
    if (payload.kind === "note") {
      if (position !== "inside") {
        return;
      }
      const destination = targetPath;
      await invoke("move_items", { items: payload.paths, destination });
      await refreshTree();
      return;
    }

    const moving = payload.paths;
    if (moving.includes(targetPath)) {
      return;
    }
    if (position === "inside") {
      if (moving.some((path) => isDescendant(path, targetPath))) {
        return;
      }
      await invoke("move_items", { items: moving, destination: targetPath });
      await refreshTree();
      return;
    }

    const parentPath = folderParentMap.parent.get(targetPath);
    if (parentPath === undefined || parentPath === null) {
      return;
    }
    const siblingPaths = folderParentMap.children.get(parentPath) || [];
    const movingSet = new Set(moving);
    if (movingSet.has(targetPath)) {
      return;
    }
    const movingNames = moving.map((path) => path.split("/").pop() || path);
    const siblingNames = siblingPaths.map((path) => path.split("/").pop() || path);
    const allSameParent = moving.every(
      (path) => folderParentMap.parent.get(path) === parentPath
    );
    const orderedMovingNames = allSameParent
      ? siblingNames.filter((name) => movingNames.includes(name))
      : movingNames;
    const remainingNames = siblingNames.filter((name) => !movingNames.includes(name));
    const targetName = targetPath.split("/").pop() || targetPath;
    const newOrderNames = reorderList(
      remainingNames,
      orderedMovingNames,
      targetName,
      position
    );
    const parentNode = findNode(tree, parentPath);
    const noteOrder = parentNode?.notes.map((note) => note.name) || [];
    if (!allSameParent) {
      await invoke("move_items", { items: moving, destination: parentPath });
    }
    await invoke("set_order", {
      parent: parentPath,
      folder_order: newOrderNames,
      note_order: noteOrder,
    });
    await refreshTree();
  };

  const handleNoteDrop = async (
    targetPath: string,
    position: DropPosition,
    payload: DragPayload
  ) => {
    if (!activeNode || payload.kind !== "note") {
      return;
    }
    const notePaths = activeNode.notes.map((note) => note.path);
    const movingSet = new Set(payload.paths);
    if (movingSet.has(targetPath)) {
      return;
    }
    const orderedMoving = notePaths.filter((path) => movingSet.has(path));
    const newOrder = reorderList(notePaths, orderedMoving, targetPath, position);
    const folderOrder = activeNode.children.map((child) => child.name);
    const noteOrder = newOrder.map((path) => path.split("/").pop() || path);
    await invoke("set_order", {
      parent: activeNode.path,
      folder_order: folderOrder,
      note_order: noteOrder,
    });
    await refreshTree();
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
    const newPath = await invoke<string>("rename_item", {
      path: renamingFolder,
      new_name: renameValue.trim(),
    });
    setRenamingFolder(null);
    setRenameValue("");
    await refreshTree();
    setActiveFolder(newPath);
    setSelectedFolders(new Set([newPath]));
    setLastSelectedFolder(newPath);
  };

  const deleteFolders = async (paths: string[]) => {
    if (paths.length === 0) {
      return;
    }
    const confirmed = window.confirm(`Delete ${paths.length} folder(s)?`);
    if (!confirmed) {
      return;
    }
    await invoke("delete_items", { items: paths });
    setSelectedFolders(new Set());
    if (paths.includes(activeFolder)) {
      setActiveFolder("");
    }
    await refreshTree();
  };

  const deleteNotes = async (paths: string[]) => {
    if (paths.length === 0) {
      return;
    }
    await invoke("delete_items", { items: paths });
    setSelectedNotes(new Set());
    if (paths.includes(activeNote || "")) {
      setActiveNote(null);
      setNoteContent("");
    }
    await refreshTree();
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragData | undefined;
    if (!data) {
      return;
    }
    setDropIndicator(null);
    if (data.kind === "folder") {
      const next = selectedFolders.has(data.path)
        ? [...selectedFolders]
        : [data.path];
      if (!selectedFolders.has(data.path)) {
        setSelectedFolders(new Set([data.path]));
      }
      const payload = { kind: "folder", paths: next };
      setDraggingPayload(payload);
      draggingPayloadRef.current = payload;
    } else {
      const next = selectedNotes.has(data.path) ? [...selectedNotes] : [data.path];
      if (!selectedNotes.has(data.path)) {
        setSelectedNotes(new Set([data.path]));
      }
      const payload = { kind: "note", paths: next };
      setDraggingPayload(payload);
      draggingPayloadRef.current = payload;
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const payload = draggingPayloadRef.current;
    const target = dropIndicator;
    setDraggingPayload(null);
    draggingPayloadRef.current = null;
    setDropIndicator(null);

    if (!payload || !target) {
      return;
    }

    if (payload.kind === "folder" && target.kind === "folder") {
      await handleFolderDrop(target.path, target.position, payload);
      return;
    }

    if (payload.kind === "note" && target.kind === "note") {
      await handleNoteDrop(target.path, target.position, payload);
      return;
    }

    if (payload.kind === "note" && target.kind === "folder") {
      await handleFolderDrop(target.path, target.position, payload);
    }
  };

  const handleDragCancel = () => {
    setDraggingPayload(null);
    draggingPayloadRef.current = null;
    setDropIndicator(null);
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const over = event.over;
    if (!over) {
      setDropIndicator(null);
      return;
    }
    const target = over.data.current as RowTarget | undefined;
    const overRect = over.rect;
    const activeRect = event.active.rect.current.translated;
    if (!target || !overRect || !activeRect) {
      setDropIndicator(null);
      return;
    }
    const payload = draggingPayloadRef.current;
    if (payload?.paths.includes(target.path)) {
      setDropIndicator(null);
      return;
    }
    const centerY = activeRect.top + activeRect.height / 2;
    const top = overRect.top;
    const bottom = overRect.bottom;
    const height = Math.max(bottom - top, 1);
    let position: DropPosition = "inside";
    if (target.kind === "note") {
      position = centerY < top + height / 2 ? "before" : "after";
    } else {
      const edge = height * 0.22;
      if (centerY < top + edge) {
        position = "before";
      } else if (centerY > bottom - edge) {
        position = "after";
      } else {
        position = "inside";
      }
    }
    setDropIndicator({ kind: target.kind, path: target.path, position });
  };

  const FolderRow = ({ node, depth }: { node: FolderNode; depth: number }) => {
    const isSelected = selectedFolders.has(node.path);
    const isExpanded = expanded.has(node.path);
    const hasChildren = node.children.length > 0;
    const dropState =
      dropIndicator?.kind === "folder" && dropIndicator.path === node.path
        ? dropIndicator.position
        : null;

    const { setNodeRef: setDragRef, listeners, attributes } = useDraggable({
      id: dragId("folder", node.path),
      data: { kind: "folder", path: node.path } satisfies DragData,
      disabled: node.path === "",
    });
    const { setNodeRef: setDropRef } = useDroppable({
      id: rowId("folder", node.path),
      data: { kind: "folder", path: node.path } satisfies RowTarget,
    });

    const setRowRef = (element: HTMLDivElement | null) => {
      setDragRef(element);
      setDropRef(element);
    };

    return (
      <div key={node.path}>
        <div
          ref={setRowRef}
          className={`item-row folder-row ${isSelected ? "selected" : ""} ${
            dropState === "inside" ? "drop-inside" : ""
          } ${dropState === "before" ? "drop-before" : ""} ${
            dropState === "after" ? "drop-after" : ""
          }`}
          style={{ paddingLeft: 12 + depth * 16 }}
          onClick={(event) => handleFolderClick(node.path, event)}
          {...attributes}
          {...listeners}
          data-drop={dropState || ""}
        >
          <button
            className="icon-btn"
            onClick={(event) => {
              event.stopPropagation();
              if (hasChildren) {
                const next = new Set(expanded);
                if (isExpanded) {
                  next.delete(node.path);
                } else {
                  next.add(node.path);
                }
                setExpanded(next);
              }
            }}
          >
            {hasChildren ? (isExpanded ? "▾" : "▸") : "•"}
          </button>
          {renamingFolder === node.path ? (
            <input
              className="rename-input"
              value={renameValue}
              autoFocus
              onChange={(event) => setRenameValue(event.target.value)}
              onBlur={submitRenameFolder}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitRenameFolder();
                }
                if (event.key === "Escape") {
                  setRenamingFolder(null);
                }
              }}
            />
          ) : (
            <span className="item-label">{node.name}</span>
          )}
          {node.path !== "" && (
            <div className="row-actions">
              <button
                className="icon-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  startRenameFolder(node.path);
                }}
              >
                Rename
              </button>
              <button
                className="icon-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  deleteFolders([node.path]);
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
        {isExpanded &&
          node.children.map((child) => (
            <FolderRow key={child.path} node={child} depth={depth + 1} />
          ))}
      </div>
    );
  };

  const NoteRow = ({ note }: { note: NoteEntry }) => {
    const isSelected = selectedNotes.has(note.path);
    const dropState =
      dropIndicator?.kind === "note" && dropIndicator.path === note.path
        ? dropIndicator.position
        : null;
    const { setNodeRef, listeners, attributes } = useDraggable({
      id: dragId("note", note.path),
      data: { kind: "note", path: note.path } satisfies DragData,
    });
    const { setNodeRef: setDropRef } = useDroppable({
      id: rowId("note", note.path),
      data: { kind: "note", path: note.path } satisfies RowTarget,
      disabled: draggingPayload?.kind === "folder",
    });

    const setRowRef = (element: HTMLDivElement | null) => {
      setNodeRef(element);
      setDropRef(element);
    };

    return (
      <div>
        <div
          ref={setRowRef}
          className={`item-row note-row ${isSelected ? "selected" : ""} ${
            dropState === "before" ? "drop-before" : ""
          } ${dropState === "after" ? "drop-after" : ""}`}
          onClick={(event) => handleNoteClick(note.path, event)}
          onContextMenu={(event) => {
            event.preventDefault();
            if (!selectedNotes.has(note.path)) {
              setSelectedNotes(new Set([note.path]));
            }
            setNoteMenu({ visible: true, x: event.clientX, y: event.clientY });
          }}
          {...attributes}
          {...listeners}
          data-drop={dropState || ""}
        >
          <span className="item-label">{note.name}</span>
        </div>
      </div>
    );
  };

  const notes = activeNode?.notes || [];
  const createdLabel = noteMeta?.created_ms
    ? new Date(noteMeta.created_ms).toLocaleString()
    : "—";
  const updatedLabel = noteMeta?.updated_ms
    ? new Date(noteMeta.updated_ms).toLocaleString()
    : "—";
  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="app">
        <div className="pane tree-pane">
          <div className="pane-header">Folders</div>
          <div className="pane-body">
            {tree ? <FolderRow node={tree} depth={0} /> : <div className="empty">Loading…</div>}
          </div>
        </div>
        <div className="pane notes-pane">
          <div className="pane-header">Notes</div>
          <div
            className="pane-body"
            onClick={() => setNoteMenu({ visible: false, x: 0, y: 0 })}
          >
            {notes.length === 0 && <div className="empty">No notes</div>}
            {notes.map((note) => (
              <NoteRow key={note.path} note={note} />
            ))}
            {noteMenu.visible && (
              <div
                className="context-menu"
                style={{ top: noteMenu.y, left: noteMenu.x }}
              >
                <button
                  onClick={async () => {
                    await deleteNotes([...selectedNotes]);
                    setNoteMenu({ visible: false, x: 0, y: 0 });
                  }}
                >
                  Delete selected
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="pane editor-pane">
          <div className="pane-header">Editor</div>
          <div className="pane-body editor-body">
            {activeNote && (
              <div className="note-meta">
                <div>Created: {createdLabel}</div>
                <div>Updated: {updatedLabel}</div>
              </div>
            )}
            {activeNote ? (
              <textarea
                className="editor"
                value={noteContent}
                onChange={(event) => setNoteContent(event.target.value)}
              />
            ) : (
              <div className="empty">Select a note to edit</div>
            )}
          </div>
        </div>
      </div>
    </DndContext>
  );
}

export default App;
