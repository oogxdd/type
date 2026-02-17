import type { MouseEvent as ReactMouseEvent } from "react";
import type { TreeItem } from "../tree/types";
import type { EdgeSnap } from "./FoldersPanel";
import { TreeRow } from "./TreeRow";
import { NavNoteRow } from "./NavNoteRow";

export type TreeNodeProps = {
  node: TreeItem;
  depth: number;
  selectedIds: Set<string>;
  selectedNoteIds: Set<string>;
  showNotesAsChildren: boolean;
  edgeSnap: EdgeSnap;
  expanded: Set<string>;
  onSelect: (event: ReactMouseEvent, id: string) => void;
  onToggle: (event: ReactMouseEvent, id: string) => void;
  onNoteSelect: (notePath: string, event: ReactMouseEvent, parentPath: string) => void;
  onNoteContextMenu: (
    event: ReactMouseEvent,
    notePath: string,
    parentPath: string
  ) => void;
  renamingFolder: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  submitRenameFolder: () => void;
  cancelRenameFolder: () => void;
  onContextMenu: (event: ReactMouseEvent, id: string) => void;
  indentationWidth: number;
};

export function TreeNode({
  node,
  depth,
  selectedIds,
  selectedNoteIds,
  showNotesAsChildren,
  edgeSnap,
  expanded,
  onSelect,
  onToggle,
  onNoteSelect,
  onNoteContextMenu,
  renamingFolder,
  renameValue,
  setRenameValue,
  submitRenameFolder,
  cancelRenameFolder,
  onContextMenu,
  indentationWidth,
}: TreeNodeProps) {
  const edgePosition = edgeSnap?.id === node.id ? edgeSnap.position : null;
  const notes = showNotesAsChildren ? node.notes || [] : [];
  const hasNestedItems = node.children.length > 0 || notes.length > 0;
  const isCollapsed = hasNestedItems && !expanded.has(node.id);
  const hasSelectedNote = showNotesAsChildren && selectedNoteIds.size > 0;
  const isFolderVisuallySelected = !hasSelectedNote && selectedIds.has(node.id);

  return (
    <div className="tree-node">
      <TreeRow
        node={node}
        depth={depth}
        isSelected={isFolderVisuallySelected}
        hasNestedItems={hasNestedItems}
        edgePosition={edgePosition}
        isCollapsed={isCollapsed}
        onSelect={onSelect}
        onToggle={onToggle}
        renaming={renamingFolder === node.id}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
        submitRenameFolder={submitRenameFolder}
        cancelRenameFolder={cancelRenameFolder}
        onContextMenu={onContextMenu}
        indentationWidth={indentationWidth}
      />
      {hasNestedItems && !isCollapsed && (
        <div className="tree-children">
          {notes.map((note) => (
            <NavNoteRow
              key={note.path}
              note={note}
              parentPath={node.id}
              depth={depth + 1}
              indentationWidth={indentationWidth}
              isSelected={selectedNoteIds.has(note.path)}
              onSelect={onNoteSelect}
              onContextMenu={onNoteContextMenu}
            />
          ))}
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              showNotesAsChildren={showNotesAsChildren}
              selectedNoteIds={selectedNoteIds}
              edgeSnap={edgeSnap}
              expanded={expanded}
              onSelect={onSelect}
              onToggle={onToggle}
              onNoteSelect={onNoteSelect}
              onNoteContextMenu={onNoteContextMenu}
              selectedIds={selectedIds}
              renamingFolder={renamingFolder}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              submitRenameFolder={submitRenameFolder}
              cancelRenameFolder={cancelRenameFolder}
              onContextMenu={onContextMenu}
              indentationWidth={indentationWidth}
            />
          ))}
        </div>
      )}
    </div>
  );
}
