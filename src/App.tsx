import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type NoteEntry = {
  name: string;
  path: string;
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

type DropPosition = "before" | "after" | "inside";

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

function parseDragPayload(event: DragEvent): DragPayload | null {
  const raw = event.dataTransfer.getData("application/x-notes-drag");
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

function isDescendant(parent: string, candidate: string) {
  return parent !== "" && (candidate === parent || candidate.startsWith(`${parent}/`));
}

function getDropPosition(event: DragEvent, allowInside: boolean): DropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / rect.height;
  if (allowInside && ratio > 0.25 && ratio < 0.75) {
    return "inside";
  }
  return ratio < 0.5 ? "before" : "after";
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
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");
  const [folderDropTarget, setFolderDropTarget] = useState<{
    path: string;
    position: DropPosition;
  } | null>(null);
  const [noteDropTarget, setNoteDropTarget] = useState<{
    path: string;
    position: DropPosition;
  } | null>(null);
  const [draggingPayload, setDraggingPayload] = useState<DragPayload | null>(null);
  const [noteMenu, setNoteMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
  }>({ visible: false, x: 0, y: 0 });
  const saveTimer = useRef<number | null>(null);

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
      return;
    }
    let cancelled = false;
    invoke<string>("read_note", { path: activeNote }).then((content) => {
      if (!cancelled) {
        setNoteContent(content);
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
      invoke("write_note", { path: activeNote, content: noteContent });
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

  const handleFolderDragStart = (path: string, event: DragEvent) => {
    const payloadPaths = selectedFolders.has(path) ? [...selectedFolders] : [path];
    if (!selectedFolders.has(path)) {
      setSelectedFolders(new Set([path]));
    }
    const payload = { kind: "folder", paths: payloadPaths } satisfies DragPayload;
    event.dataTransfer.setData("application/x-notes-drag", JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "move";
    setDraggingPayload(payload);
  };

  const handleNoteDragStart = (path: string, event: DragEvent) => {
    const payloadPaths = selectedNotes.has(path) ? [...selectedNotes] : [path];
    if (!selectedNotes.has(path)) {
      setSelectedNotes(new Set([path]));
    }
    const payload = { kind: "note", paths: payloadPaths } satisfies DragPayload;
    event.dataTransfer.setData("application/x-notes-drag", JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "move";
    setDraggingPayload(payload);
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
    const allSameParent = moving.every(
      (path) => folderParentMap.parent.get(path) === parentPath
    );
    if (!allSameParent) {
      return;
    }
    const orderedMoving = siblingPaths.filter((path) => movingSet.has(path));
    const newOrder = reorderList(siblingPaths, orderedMoving, targetPath, position);
    const parentNode = findNode(tree, parentPath);
    const noteOrder = parentNode?.notes.map((note) => note.name) || [];
    const folderOrder = newOrder.map((path) => path.split("/").pop() || path);
    await invoke("set_order", {
      parent: parentPath,
      folder_order: folderOrder,
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

  const renderFolderRow = (node: FolderNode, depth: number) => {
    const isSelected = selectedFolders.has(node.path);
    const isExpanded = expanded.has(node.path);
    const hasChildren = node.children.length > 0;
    const dropState =
      folderDropTarget?.path === node.path ? folderDropTarget.position : null;
    const canShowDropLines = draggingPayload?.kind === "folder" && node.path !== "";
    const canDropInside = draggingPayload?.kind === "folder" || draggingPayload?.kind === "note";

    return (
      <div key={node.path}>
        {canShowDropLines && (
          <div
            className={`drop-line ${
              dropState === "before" ? "active" : ""
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setFolderDropTarget({ path: node.path, position: "before" });
            }}
            onDragLeave={() => setFolderDropTarget(null)}
            onDrop={async (event) => {
              event.preventDefault();
              const payload = parseDragPayload(event);
              setFolderDropTarget(null);
              if (!payload) {
                return;
              }
              await handleFolderDrop(node.path, "before", payload);
            }}
          />
        )}
        <div
          className={`item-row folder-row ${isSelected ? "selected" : ""} ${
            dropState === "inside" ? "drop-inside" : ""
          }`}
          style={{ paddingLeft: 12 + depth * 16 }}
          draggable={node.path !== ""}
          onClick={(event) => handleFolderClick(node.path, event)}
          onDragStart={(event) => handleFolderDragStart(node.path, event)}
          onDragEnd={() => {
            setDraggingPayload(null);
            setFolderDropTarget(null);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (canDropInside) {
              setFolderDropTarget({ path: node.path, position: "inside" });
            }
          }}
          onDragLeave={() => setFolderDropTarget(null)}
          onDrop={async (event) => {
            event.preventDefault();
            const payload = parseDragPayload(event);
            setFolderDropTarget(null);
            if (!payload) {
              return;
            }
            await handleFolderDrop(node.path, "inside", payload);
          }}
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
        {canShowDropLines && (
          <div
            className={`drop-line ${
              dropState === "after" ? "active" : ""
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setFolderDropTarget({ path: node.path, position: "after" });
            }}
            onDragLeave={() => setFolderDropTarget(null)}
            onDrop={async (event) => {
              event.preventDefault();
              const payload = parseDragPayload(event);
              setFolderDropTarget(null);
              if (!payload) {
                return;
              }
              await handleFolderDrop(node.path, "after", payload);
            }}
          />
        )}
        {isExpanded &&
          node.children.map((child) => renderFolderRow(child, depth + 1))}
      </div>
    );
  };

  const notes = activeNode?.notes || [];

  return (
    <div className="app">
      <div className="pane tree-pane">
        <div className="pane-header">Folders</div>
        <div className="pane-body">
          {tree ? renderFolderRow(tree, 0) : <div className="empty">Loading…</div>}
        </div>
      </div>
      <div className="pane notes-pane">
        <div className="pane-header">Notes</div>
        <div
          className="pane-body"
          onClick={() => setNoteMenu({ visible: false, x: 0, y: 0 })}
          onDragOver={(event) => {
            if (draggingPayload?.kind === "note") {
              event.preventDefault();
            }
          }}
          onDrop={async (event) => {
            if (draggingPayload?.kind !== "note" || !activeNode) {
              return;
            }
            event.preventDefault();
            const payload = parseDragPayload(event);
            if (!payload) {
              return;
            }
            await invoke("move_items", { items: payload.paths, destination: activeNode.path });
            await refreshTree();
          }}
        >
          {notes.length === 0 && <div className="empty">No notes</div>}
          {notes.map((note) => {
            const isSelected = selectedNotes.has(note.path);
            const dropState =
              noteDropTarget?.path === note.path ? noteDropTarget.position : null;
            return (
              <div key={note.path}>
                {draggingPayload?.kind === "note" && (
                  <div
                    className={`drop-line ${
                      dropState === "before" ? "active" : ""
                    }`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setNoteDropTarget({ path: note.path, position: "before" });
                    }}
                    onDragLeave={() => setNoteDropTarget(null)}
                    onDrop={async (event) => {
                      event.preventDefault();
                      const payload = parseDragPayload(event);
                      setNoteDropTarget(null);
                      if (!payload) {
                        return;
                      }
                      await handleNoteDrop(note.path, "before", payload);
                    }}
                  />
                )}
                <div
                  className={`item-row note-row ${isSelected ? "selected" : ""} ${
                    dropState === "inside" ? "drop-inside" : ""
                  }`}
                  draggable
                  onClick={(event) => handleNoteClick(note.path, event)}
                  onDragStart={(event) => handleNoteDragStart(note.path, event)}
                  onDragEnd={() => {
                    setDraggingPayload(null);
                    setNoteDropTarget(null);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (!selectedNotes.has(note.path)) {
                      setSelectedNotes(new Set([note.path]));
                    }
                    setNoteMenu({ visible: true, x: event.clientX, y: event.clientY });
                  }}
                >
                  <span className="item-label">{note.name}</span>
                </div>
                {draggingPayload?.kind === "note" && (
                  <div
                    className={`drop-line ${
                      dropState === "after" ? "active" : ""
                    }`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setNoteDropTarget({ path: note.path, position: "after" });
                    }}
                    onDragLeave={() => setNoteDropTarget(null)}
                    onDrop={async (event) => {
                      event.preventDefault();
                      const payload = parseDragPayload(event);
                      setNoteDropTarget(null);
                      if (!payload) {
                        return;
                      }
                      await handleNoteDrop(note.path, "after", payload);
                    }}
                  />
                )}
              </div>
            );
          })}
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
  );
}

export default App;
