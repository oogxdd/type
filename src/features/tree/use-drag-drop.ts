import { useCallback, useRef, useState } from "react";
import type {
  DragEndEvent,
  DragMoveEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { moveItems, setOrder } from "@/data/notesApi";
import { logGroup } from "@/data/invoke";
import type { DragData, FolderNode } from "@/types";
import { isSystemFolder } from "@/constants";
import { getNoteParentPath } from "@/utils/notes";
import { DROP_PREFIX } from "./folders-panel";
import {
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
} from "./tree-ops";
import type { TreeItem } from "./types";
import type { FlattenedItem } from "./types";

type UseDragDropArgs = {
  tree: FolderNode | null;
  setTree: React.Dispatch<React.SetStateAction<FolderNode | null>>;
  treeData: TreeItem[];
  flatItems: FlattenedItem[];
  orderedIds: string[];
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedFolders: Set<string>;
  setSelectedFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
  setLastSelectedFolder: (path: string) => void;
  selectedNotes: Set<string>;
  setSelectedNotes: React.Dispatch<React.SetStateAction<Set<string>>>;
  setLastSelectedNote: (path: string) => void;
  setActiveNote: (path: string | null) => void;
  activeNote: string | null;
  clearNote: () => void;
  refreshTree: () => Promise<void>;
  parentById: Record<string, string | null>;
};

export function useDragDrop({
  tree,
  setTree,
  treeData,
  flatItems,
  orderedIds,
  expanded,
  setExpanded,
  selectedFolders,
  setSelectedFolders,
  setLastSelectedFolder,
  selectedNotes,
  setSelectedNotes,
  setLastSelectedNote,
  setActiveNote,
  activeNote,
  clearNote,
  refreshTree,
  parentById,
}: UseDragDropArgs) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [edgeSnap, setEdgeSnap] = useState<{
    id: string;
    position: "before" | "after";
  } | null>(null);
  const activeDrag = useRef<DragData | null>(null);
  const dragStartPoint = useRef<{ x: number; y: number } | null>(null);
  const expandTimeoutRef = useRef<number | null>(null);
  const expandTargetRef = useRef<string | null>(null);

  const handleDragStart = useCallback(
    ({ active, activatorEvent }: DragStartEvent) => {
      const data = active.data.current as DragData | undefined;
      if (!data) return;
      activeDrag.current = data;
      logGroup("drag start", {
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
    },
    [setSelectedFolders, setLastSelectedFolder, setSelectedNotes, setLastSelectedNote, setActiveNote]
  );

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
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
    },
    [expanded, setExpanded, treeData]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      if (activeDrag.current?.type !== "folder") return;
      if (!event.over) setEdgeSnap(null);
    },
    []
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
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
          logGroup("drop ignored", {
            reason: "target inside dragged subtree",
            target: dropTarget,
          });
          return;
        }

        const orderedDraggingIds = sortIdsByTreeOrder(draggingIds, orderedIds);
        if (orderedDraggingIds.some(isSystemFolder)) {
          logGroup("drop ignored", { reason: "system folder drag blocked" });
          return;
        }
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
            await moveItems([id], newParent ?? "");
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
          await setOrder({
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
          logGroup("note drop ignored", { reason: "missing target" });
          return;
        }
        const selectedList = selectedNotes.has(data.path)
          ? Array.from(selectedNotes)
          : [data.path];
        const sourceParentPath = getNoteParentPath(data.path);
        if (overData.type === "folder") {
          logGroup("note move to folder", {
            notes: selectedList,
            destination: overData.path,
          });
          await moveItems(selectedList, overData.path);
          if (selectedList.includes(activeNote || "")) {
            setActiveNote(null);
            clearNote();
          }
          setSelectedNotes(new Set());
          setLastSelectedNote("");
          await refreshTree();
          return;
        }
        if (overData.type === "note") {
          const destinationParentPath = getNoteParentPath(overData.path);
          if (destinationParentPath !== sourceParentPath) {
            logGroup("note move to note parent", {
              notes: selectedList,
              destination: destinationParentPath,
              over: overData.path,
            });
            await moveItems(selectedList, destinationParentPath);
            if (selectedList.includes(activeNote || "")) {
              setActiveNote(null);
              clearNote();
            }
            setSelectedNotes(new Set());
            setLastSelectedNote("");
            await refreshTree();
            return;
          }

          const parentNode = findNode(tree, destinationParentPath);
          if (!parentNode) {
            logGroup("note drop ignored", {
              reason: "missing destination parent",
              destinationParentPath,
            });
            return;
          }

          const movingInParent = selectedList.filter(
            (notePath) => getNoteParentPath(notePath) === destinationParentPath
          );
          const movingNotes =
            movingInParent.length > 0 ? movingInParent : [data.path];
          if (movingNotes.includes(overData.path)) return;

          const notePaths = parentNode.notes.map((n) => n.path);
          const newOrder = reorderList(notePaths, movingNotes, overData.path);
          const folderOrder = parentNode.children.map((c) => c.name);
          const noteOrder = newOrder.map((p) => p.split("/").pop() || p);
          logGroup("note reorder", {
            parent: parentNode.path,
            dragging: movingNotes,
            over: overData.path,
            noteOrder,
            folderOrder,
          });
          await setOrder({
            parent: parentNode.path,
            folderOrder,
            noteOrder,
          });
          await refreshTree();
        }
      }
    },
    [
      activeNote,
      clearNote,
      edgeSnap,
      flatItems,
      orderedIds,
      parentById,
      refreshTree,
      selectedFolders,
      selectedNotes,
      setActiveNote,
      setLastSelectedNote,
      setSelectedNotes,
      setTree,
      tree,
      treeData,
    ]
  );

  const handleDragCancel = useCallback(() => {
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
  }, []);

  return {
    activeId,
    edgeSnap,
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
