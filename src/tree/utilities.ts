import type { FlattenedItem, Projection, TreeItem } from "./types";

export function buildTree(items: FlattenedItem[]): TreeItem[] {
  const root: TreeItem[] = [];
  const nodes = new Map<string, TreeItem>();

  for (const item of items) {
    nodes.set(item.id, { id: item.id, name: item.name, children: [] });
  }

  for (const item of items) {
    const node = nodes.get(item.id);
    if (!node) {
      continue;
    }
    if (item.parentId) {
      const parent = nodes.get(item.parentId);
      if (parent) {
        parent.children.push(node);
      }
    } else {
      root.push(node);
    }
  }

  return root;
}

export function flattenTree(
  items: TreeItem[],
  parentId: string | null = null,
  depth = 0
): FlattenedItem[] {
  return items.flatMap((item) => [
    { id: item.id, name: item.name, parentId, depth, children: item.children },
    ...flattenTree(item.children, item.id, depth + 1),
  ]);
}

export function removeChildrenOf(items: FlattenedItem[], ids: string[]) {
  const excluded = new Set(ids);
  return items.filter((item) => {
    if (item.parentId && excluded.has(item.parentId)) {
      excluded.add(item.id);
      return false;
    }
    return true;
  });
}

export function getChildCount(items: TreeItem[], id: string): number {
  const search = (nodes: TreeItem[]): number => {
    for (const node of nodes) {
      if (node.id === id) {
        return countChildren(node);
      }
      const result = search(node.children);
      if (result > -1) {
        return result;
      }
    }
    return -1;
  };

  const countChildren = (node: TreeItem): number => {
    return node.children.reduce((acc, child) => acc + 1 + countChildren(child), 0);
  };

  const result = search(items);
  return result === -1 ? 0 : result;
}

export function getProjection(
  items: FlattenedItem[],
  activeId: string,
  overId: string,
  offsetLeft: number,
  indentationWidth: number
): Projection {
  const activeIndex = items.findIndex((item) => item.id === activeId);
  const overIndex = items.findIndex((item) => item.id === overId);
  const activeItem = items[activeIndex];
  const newItems = arrayMove(items, activeIndex, overIndex);
  const previousItem = newItems[overIndex - 1];
  const nextItem = newItems[overIndex + 1];
  const projectedDepth =
    activeItem.depth + Math.round(offsetLeft / indentationWidth);

  const maxDepth = previousItem ? previousItem.depth + 1 : 0;
  const minDepth = nextItem ? nextItem.depth : 0;
  const depth = Math.max(minDepth, Math.min(projectedDepth, maxDepth));

  const parentId = depth === 0 ? null : findParentId(newItems, overIndex, depth);

  return { depth, parentId };
}

export function removeItem(items: TreeItem[], id: string) {
  return items.reduce<TreeItem[]>((acc, item) => {
    if (item.id === id) {
      return acc;
    }
    if (item.children.length) {
      acc.push({ ...item, children: removeItem(item.children, id) });
    } else {
      acc.push(item);
    }
    return acc;
  }, []);
}

export function setProperty(
  items: TreeItem[],
  id: string,
  property: keyof TreeItem,
  setter: (value: boolean) => boolean
) {
  return items.map((item) => {
    if (item.id === id) {
      return { ...item, [property]: setter(Boolean(item[property])) };
    }
    if (item.children.length) {
      return { ...item, children: setProperty(item.children, id, property, setter) };
    }
    return item;
  });
}

export function arrayMove<T>(array: T[], from: number, to: number) {
  const copy = [...array];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

function findParentId(
  items: FlattenedItem[],
  overIndex: number,
  depth: number
) {
  if (depth === 0) {
    return null;
  }
  for (let i = overIndex - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.depth === depth - 1) {
      return item.id;
    }
  }
  return null;
}
