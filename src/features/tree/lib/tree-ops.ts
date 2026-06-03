import type { FolderNode } from "@/shared/types";
import type { TreeItem } from "./types";
import { flattenTree } from "./dnd-tree";
import { DROP_PREFIX, ROOT_ID } from "./tree-dnd";

export function buildTreeItems(node: FolderNode): TreeItem[] {
  return node.children.map((child) => ({
    id: child.path,
    name: child.name,
    noteCount: child.notes.length,
    notes: child.notes,
    children: buildTreeItems(child),
  }));
}

export type FlatNode = {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
};

export const flattenTreeData = (
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

export const arraysEqual = (a: string[] | undefined, b: string[] | undefined) => {
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

export const buildFolderOrderMap = (
  nodes: TreeItem[],
  parentId: string | null,
  map: Record<string, string[]>
) => {
  map[parentId ?? ""] = nodes.map((node) => node.id.split("/").pop() || node.id);
  nodes.forEach((node) => buildFolderOrderMap(node.children, node.id, map));
};

export const applyFolderOrder = (
  node: FolderNode,
  orderMap: Record<string, string[]>
): FolderNode => {
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

export const findParentAndIndex = (
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

export const getNodeById = (nodes: TreeItem[], id: string): TreeItem | null => {
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

export const removeNodes = (nodes: TreeItem[], ids: string[]) => {
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

export const insertNodes = (
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

export type DropTarget =
  | { type: "root"; position: "inside" }
  | { type: "item"; itemId: string; position: "inside" | "before" | "after" };

export const parseDropTargetId = (id: string | number | null): DropTarget | null => {
  if (typeof id !== "string") {
    return null;
  }
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== DROP_PREFIX) {
    return null;
  }
  const itemId = parts[1];
  const position = parts[2];
  if (
    !itemId ||
    !position ||
    (position !== "inside" && position !== "before" && position !== "after")
  ) {
    return null;
  }
  if (itemId === ROOT_ID) {
    return position === "inside" ? { type: "root", position } : null;
  }
  return { type: "item", itemId, position };
};

export const sortIdsByTreeOrder = (ids: string[], orderedIds: string[]) => {
  const orderIndex = new Map<string, number>();
  orderedIds.forEach((id, index) => {
    orderIndex.set(id, index);
  });
  return ids.slice().sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
};

export const isDescendantOf = (
  nodes: TreeItem[],
  ancestorId: string,
  targetId: string
) => {
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

export const isInDraggedSubtree = (
  nodes: TreeItem[],
  draggedIds: string[],
  targetId: string
) => {
  return draggedIds.some(
    (draggedId) => draggedId === targetId || isDescendantOf(nodes, draggedId, targetId)
  );
};

export const getTopLevelSelected = (
  selectedIds: string[],
  parentById: Record<string, string | null>
) => {
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

export function findNode(node: FolderNode | null, path: string): FolderNode | null {
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

export function reorderList(list: string[], moving: string[], target: string) {
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

export const buildNoteOrderMap = (
  node: FolderNode | null,
  map: Record<string, string[]>
) => {
  if (!node) {
    return;
  }
  map[node.path] = node.notes.map((note) => note.name);
  node.children.forEach((child) => buildNoteOrderMap(child, map));
};

export { flattenTree };
