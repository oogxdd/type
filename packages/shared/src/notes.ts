import type { FolderNode, NoteEntry } from "./types";

export const getNoteParentPath = (notePath: string) => {
  const slashIndex = notePath.lastIndexOf("/");
  return slashIndex === -1 ? "" : notePath.slice(0, slashIndex);
};

export const collectAllNotes = (node: FolderNode | null): NoteEntry[] => {
  if (!node) {
    return [];
  }
  const output: NoteEntry[] = [];
  const walk = (current: FolderNode) => {
    current.notes.forEach((note) => output.push(note));
    current.children.forEach((child) => walk(child));
  };
  walk(node);
  return output;
};

// Every folder path in the tree (excluding the root node itself), depth-first.
// Used by the command palette's `mv` terminal command for path autocomplete.
export const collectFolderPaths = (node: FolderNode | null): string[] => {
  if (!node) {
    return [];
  }
  const output: string[] = [];
  const walk = (current: FolderNode, isRoot: boolean) => {
    if (!isRoot && current.path) {
      output.push(current.path);
    }
    current.children.forEach((child) => walk(child, false));
  };
  walk(node, true);
  return output;
};
