import type { MouseEvent } from "react";
import { useCallback } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { TreeItem } from "../tree/types";
import type { DragData } from "../types";

const DROP_PREFIX = "drop";
const ROOT_ID = "root";

const dropId = (id: string, position: "inside") => `${DROP_PREFIX}:${id}:${position}`;

type EdgeSnap = { id: string; position: "before" | "after" } | null;

type FoldersPanelProps = {
  treeData: TreeItem[];
  selectedIds: Set<string>;
  onSelect: (event: MouseEvent, id: string) => void;
  edgeSnap: EdgeSnap;
  expanded: Set<string>;
  onToggle: (event: MouseEvent, id: string) => void;
  onClearSelection: () => void;
  renamingFolder: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  submitRenameFolder: () => void;
  cancelRenameFolder: () => void;
  startRenameFolder: (path: string) => void;
  deleteFolders: (paths: string[]) => void;
  indentationWidth: number;
};

type TreeRowProps = {
  node: TreeItem;
  depth: number;
  isSelected: boolean;
  edgePosition: "before" | "after" | null;
  isCollapsed: boolean;
  onSelect: (event: MouseEvent, id: string) => void;
  onToggle: (event: MouseEvent, id: string) => void;
  renaming: boolean;
  renameValue: string;
  setRenameValue: (value: string) => void;
  submitRenameFolder: () => void;
  cancelRenameFolder: () => void;
  startRenameFolder: (path: string) => void;
  deleteFolders: (paths: string[]) => void;
  indentationWidth: number;
};

function TreeRow({
  node,
  depth,
  isSelected,
  edgePosition,
  isCollapsed,
  onSelect,
  onToggle,
  renaming,
  renameValue,
  setRenameValue,
  submitRenameFolder,
  cancelRenameFolder,
  startRenameFolder,
  deleteFolders,
  indentationWidth,
}: TreeRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: node.id,
    data: { type: "folder", path: node.id } satisfies DragData,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dropId(node.id, "inside"),
    data: { type: "folder", path: node.id } satisfies DragData,
  });

  const setRefs = useCallback(
    (element: HTMLDivElement | null) => {
      setNodeRef(element);
      setDropRef(element);
    },
    [setNodeRef, setDropRef]
  );

  const style: React.CSSProperties = {
    transform: isDragging ? undefined : CSS.Translate.toString(transform),
    paddingLeft: 12 + depth * indentationWidth,
  };

  return (
    <div
      ref={setRefs}
      style={style}
      className={`item-row folder-row${isSelected ? " selected" : ""}${
        isDragging ? " is-dragging" : ""
      }${isOver && !edgePosition ? " drop-inside" : ""}${
        edgePosition === "before" ? " drop-before" : ""
      }${edgePosition === "after" ? " drop-after" : ""}`}
      onClick={(event) => onSelect(event, node.id)}
      {...listeners}
      {...attributes}
    >
      {node.children.length > 0 ? (
        <button
          type="button"
          className="icon-btn"
          onClick={(event) => onToggle(event, node.id)}
          onPointerDown={(event) => event.stopPropagation()}
          aria-label={isCollapsed ? "Expand folder" : "Collapse folder"}
        >
          {isCollapsed ? "▸" : "▾"}
        </button>
      ) : (
        <button type="button" className="icon-btn" aria-hidden>
          •
        </button>
      )}
      {renaming ? (
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
              cancelRenameFolder();
            }
          }}
        />
      ) : (
        <span className="item-label">{node.name}</span>
      )}
      {!renaming && (
        <div className="row-actions">
          <button
            className="icon-btn"
            onClick={(event) => {
              event.stopPropagation();
              startRenameFolder(node.id);
            }}
          >
            Rename
          </button>
          <button
            className="icon-btn"
            onClick={(event) => {
              event.stopPropagation();
              deleteFolders([node.id]);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

type TreeNodeProps = {
  node: TreeItem;
  depth: number;
  selectedIds: Set<string>;
  edgeSnap: EdgeSnap;
  expanded: Set<string>;
  onSelect: (event: MouseEvent, id: string) => void;
  onToggle: (event: MouseEvent, id: string) => void;
  renamingFolder: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  submitRenameFolder: () => void;
  cancelRenameFolder: () => void;
  startRenameFolder: (path: string) => void;
  deleteFolders: (paths: string[]) => void;
  indentationWidth: number;
};

function TreeNode({
  node,
  depth,
  selectedIds,
  edgeSnap,
  expanded,
  onSelect,
  onToggle,
  renamingFolder,
  renameValue,
  setRenameValue,
  submitRenameFolder,
  cancelRenameFolder,
  startRenameFolder,
  deleteFolders,
  indentationWidth,
}: TreeNodeProps) {
  const edgePosition = edgeSnap?.id === node.id ? edgeSnap.position : null;
  const isCollapsed = node.children.length > 0 && !expanded.has(node.id);

  return (
    <div className="tree-node">
      <TreeRow
        node={node}
        depth={depth}
        isSelected={selectedIds.has(node.id)}
        edgePosition={edgePosition}
        isCollapsed={isCollapsed}
        onSelect={onSelect}
        onToggle={onToggle}
        renaming={renamingFolder === node.id}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
        submitRenameFolder={submitRenameFolder}
        cancelRenameFolder={cancelRenameFolder}
        startRenameFolder={startRenameFolder}
        deleteFolders={deleteFolders}
        indentationWidth={indentationWidth}
      />
      {node.children.length > 0 && !isCollapsed && (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              edgeSnap={edgeSnap}
              expanded={expanded}
              onSelect={onSelect}
              onToggle={onToggle}
              selectedIds={selectedIds}
              renamingFolder={renamingFolder}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              submitRenameFolder={submitRenameFolder}
              cancelRenameFolder={cancelRenameFolder}
              startRenameFolder={startRenameFolder}
              deleteFolders={deleteFolders}
              indentationWidth={indentationWidth}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FoldersPanel({
  treeData,
  selectedIds,
  onSelect,
  edgeSnap,
  expanded,
  onToggle,
  onClearSelection,
  renamingFolder,
  renameValue,
  setRenameValue,
  submitRenameFolder,
  cancelRenameFolder,
  startRenameFolder,
  deleteFolders,
  indentationWidth,
}: FoldersPanelProps) {
  const { setNodeRef: setRootDropRef, isOver } = useDroppable({
    id: dropId(ROOT_ID, "inside"),
  });

  return (
    <div className="pane tree-pane">
      <div className="pane-header">Folders</div>
      <div
        ref={setRootDropRef}
        className={`pane-body tree-root${isOver ? " drop-inside" : ""}`}
        onClick={onClearSelection}
      >
        {treeData.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            depth={0}
            edgeSnap={edgeSnap}
            expanded={expanded}
            onToggle={onToggle}
            selectedIds={selectedIds}
            onSelect={onSelect}
            renamingFolder={renamingFolder}
            renameValue={renameValue}
            setRenameValue={setRenameValue}
            submitRenameFolder={submitRenameFolder}
            cancelRenameFolder={cancelRenameFolder}
            startRenameFolder={startRenameFolder}
            deleteFolders={deleteFolders}
            indentationWidth={indentationWidth}
          />
        ))}
      </div>
    </div>
  );
}

export { DROP_PREFIX, ROOT_ID, dropId };
