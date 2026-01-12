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
      onMouseDown={(event) => {
        console.log("[folders] select mouse", node.id);
        onSelect(event, node.id);
      }}
      {...listeners}
      {...attributes}
    >
      {node.children.length > 0 ? (
        <button
          type="button"
          className="icon-btn tree-toggle"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(event, node.id);
            onToggle(event, node.id);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          aria-label={isCollapsed ? "Expand folder" : "Collapse folder"}
        >
          {isCollapsed ? "▸" : "▾"}
        </button>
      ) : (
        <span className="icon-spacer" aria-hidden />
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
        <div
          className="row-actions"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="icon-btn row-action-btn"
            onClick={(event) => {
              event.stopPropagation();
              onSelect(event, node.id);
              startRenameFolder(node.id);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            aria-label="Rename folder"
            title="Rename"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M4 16.5V20h3.5L18.6 8.9a1 1 0 0 0 0-1.4l-2.1-2.1a1 1 0 0 0-1.4 0L4 16.5z"
                fill="currentColor"
              />
              <path d="M13.8 5.2l3 3" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
          <button
            className="icon-btn row-action-btn"
            onClick={(event) => {
              event.stopPropagation();
              console.log("[folders] delete click", node.id);
              onSelect(event, node.id);
              deleteFolders([node.id]);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            aria-label="Delete folder"
            title="Delete"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6 7h12l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7z"
                fill="currentColor"
              />
              <path
                d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"
                fill="currentColor"
              />
              <path d="M4 7h16" stroke="currentColor" strokeWidth="1.6" />
            </svg>
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
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onClearSelection();
          }
        }}
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
