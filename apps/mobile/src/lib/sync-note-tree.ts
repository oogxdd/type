import type { FolderNode, GitSyncFolderPatch, NoteEntry } from "@typenotes/shared/types";
import { STREAM_FOLDER_PATH } from "@typenotes/shared/constants";

const hidden = new Set(["_system/agent", "_system/me", "_system/reviews", "_system/_attachments", "_system/_handwriting", "_system/_recordings"]);
export const visibleSyncPath = (path: string) => {
  const parts = path.split("/");
  if (parts.some((part) => part.startsWith("."))) return false;
  return !parts.some((_, index) => hidden.has(parts.slice(0, index + 1).join("/")));
};
const parent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const ordered = <T extends { name: string }>(items: T[], order: string[], descending = false) => {
  const positions = new Map(order.map((name, index) => [name, index]));
  return items.sort((a, b) => {
    const rank = descending ? 0 : (positions.get(a.name) ?? Infinity) - (positions.get(b.name) ?? Infinity);
    if (rank && !Number.isNaN(rank)) return rank;
    const left = a.name.toLowerCase(), right = b.name.toLowerCase();
    const comparison = left < right ? -1 : left > right ? 1 : 0;
    return descending ? -comparison : comparison;
  });
};

/** Apply changed entries and ancestor order files without scanning the disk. */
export const applySyncTreePatch = (
  tree: FolderNode,
  entries: NoteEntry[],
  removed: string[],
  folders: GitSyncFolderPatch[]
): FolderNode => {
  const patches = new Map(folders.filter((item) => visibleSyncPath(item.path)).map((item) => [item.path, item]));
  // A compact read may observe a file recreated after the native patch was
  // captured. Its presence is newer evidence than an absent ancestor snapshot.
  for (const entry of entries.filter((item) => visibleSyncPath(item.path))) {
    let dir = parent(entry.path);
    while (dir) {
      const patch = patches.get(dir);
      if (patch?.exists === false) patches.set(dir, { ...patch, exists: true });
      dir = parent(dir);
    }
  }
  const additions = new Map<string, NoteEntry[]>();
  for (const entry of entries.filter((item) => visibleSyncPath(item.path))) {
    const dir = parent(entry.path);
    additions.set(dir, [...(additions.get(dir) ?? []), entry]);
  }
  const deleted = new Set(removed);
  const visit = (node: FolderNode): FolderNode => {
    const patch = patches.get(node.path);
    const updates = new Map((additions.get(node.path) ?? []).map((entry) => [entry.path, entry]));
    let notes = node.notes.filter((entry) => !deleted.has(entry.path)).map((entry) => {
      const next = updates.get(entry.path); updates.delete(entry.path);
      return next && next.version !== entry.version ? next : entry;
    });
    const added = updates.size;
    notes.push(...updates.values());
    const children = node.children.filter((child) => patches.get(child.path)?.exists !== false).map(visit);
    const known = new Set(children.map((child) => child.path));
    for (const child of patches.values()) {
      if (!child.path || !child.exists || parent(child.path) !== node.path || known.has(child.path)) continue;
      children.push(visit({ path: child.path, name: child.path.split("/").at(-1)!, notes: [], children: [] }));
    }
    if (patch || additions.has(node.path)) {
      if (node.path !== STREAM_FOLDER_PATH || added > 0) notes = ordered(notes, patch?.note_order ?? [], node.path === STREAM_FOLDER_PATH);
      ordered(children, patch?.folder_order ?? []);
    }
    if (notes.length === node.notes.length && notes.every((entry, index) => entry === node.notes[index]) &&
        children.length === node.children.length && children.every((child, index) => child === node.children[index])) return node;
    return { ...node, notes, children };
  };
  return visit(tree);
};
