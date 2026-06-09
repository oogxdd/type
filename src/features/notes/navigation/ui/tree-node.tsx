// Recursive navigation renderer for folder trees and feed buckets.
import type { MouseEvent as ReactMouseEvent } from "react";
import type { EdgeSnap } from "../model/tree-dnd";
import { TreeRow } from "./tree-row";
import { NavNoteRow } from "./nav-note-row";
import type { NotePreview } from "@/shared/lib/format";
import type { NavigationNode } from "../model/types";

export type TreeNodeProps = {
  node: NavigationNode;
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
  notePreviews: Record<string, NotePreview>;
  renamingFolder?: string | null;
  renameValue?: string;
  setRenameValue?: (value: string) => void;
  submitRenameFolder?: () => void;
  cancelRenameFolder?: () => void;
  onContextMenu: (event: ReactMouseEvent, id: string) => void;
  indentationWidth: number;
  draggable?: boolean;
  feedMode?: boolean;
  renamingEnabled?: boolean;
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
  notePreviews,
  renamingFolder = null,
  renameValue = "",
  setRenameValue = () => {
    return;
  },
  submitRenameFolder = () => {
    return;
  },
  cancelRenameFolder = () => {
    return;
  },
  onContextMenu,
  indentationWidth,
  draggable = true,
  feedMode = false,
  renamingEnabled = true,
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
        draggable={draggable}
        feedMode={feedMode}
        renamingEnabled={renamingEnabled}
      />
      {hasNestedItems && !isCollapsed && (
        <div className="tree-children">
          {notes.map((note) => (
            <NavNoteRow
              key={note.path}
              note={note}
              preview={notePreviews[note.path]}
              parentPath={node.id}
              depth={depth + 1}
              indentationWidth={indentationWidth}
              isSelected={selectedNoteIds.has(note.path)}
              onSelect={onNoteSelect}
              onContextMenu={onNoteContextMenu}
              draggable={draggable}
              showGuides={feedMode}
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
              notePreviews={notePreviews}
              selectedIds={selectedIds}
              renamingFolder={renamingFolder}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              submitRenameFolder={submitRenameFolder}
              cancelRenameFolder={cancelRenameFolder}
              onContextMenu={onContextMenu}
              indentationWidth={indentationWidth}
              draggable={draggable}
              feedMode={feedMode}
              renamingEnabled={renamingEnabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}
