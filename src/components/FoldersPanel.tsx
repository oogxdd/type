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
  onPaneKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaneClick?: () => void;
  paneBodyRef?: React.Ref<HTMLDivElement>;
  renamingFolder: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  submitRenameFolder: () => void;
  cancelRenameFolder: () => void;
  onContextMenu: (event: MouseEvent, id: string) => void;
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
  onContextMenu: (event: MouseEvent, id: string) => void;
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
  onContextMenu,
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
      data-folder={node.id}
      onClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (target && target.closest(".tree-toggle, .rename-input")) {
          return;
        }
        console.log("[folders] select click", node.id);
        onSelect(event, node.id);
      }}
      onContextMenu={(event) => {
        onContextMenu(event, node.id);
      }}
      {...listeners}
      {...attributes}
    >
      {node.children.length > 0 ? (
        <button
          type="button"
          className={`icon-btn tree-toggle${isCollapsed ? " is-collapsed" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(event, node.id);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          aria-label={isCollapsed ? "Expand folder" : "Collapse folder"}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      ) : (
        <span className="icon-spacer" aria-hidden />
      )}
      {!renaming && (
        <span className="folder-glyph" aria-hidden>
          {node.children.length > 0 && !isCollapsed ? (
            <svg viewBox="0 0 24 24">
              <path
                d="M3 8a2.5 2.5 0 0 1 2.5-2.5h4L11.4 7h7.1A2.5 2.5 0 0 1 21 9.5V11"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2.8 10.5h18.4a1 1 0 0 1 .96 1.28l-1.65 5.5A2.5 2.5 0 0 1 18.1 19H5.9a2.5 2.5 0 0 1-2.4-1.72l-1.65-5.5a1 1 0 0 1 .95-1.28z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24">
              <path
                d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      )}
      {renaming ? (
        <input
          className="rename-input"
          value={renameValue}
          autoFocus
          onChange={(event) => setRenameValue(event.target.value)}
          onBlur={submitRenameFolder}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              submitRenameFolder();
            }
            if (event.key === "Escape") {
              cancelRenameFolder();
            }
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        <span className="item-label">{node.name}</span>
      )}
      {!renaming && node.noteCount ? (
        <span className="note-count" title={`${node.noteCount} notes`}>
          {node.noteCount}
        </span>
      ) : null}
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
  onContextMenu: (event: MouseEvent, id: string) => void;
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
  onContextMenu,
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
        onContextMenu={onContextMenu}
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
              onContextMenu={onContextMenu}
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
  onPaneKeyDown,
  onPaneClick,
  paneBodyRef,
  renamingFolder,
  renameValue,
  setRenameValue,
  submitRenameFolder,
  cancelRenameFolder,
  onContextMenu,
  indentationWidth,
}: FoldersPanelProps) {
  const { setNodeRef: setRootDropRef, isOver } = useDroppable({
    id: dropId(ROOT_ID, "inside"),
  });

  return (
    <div className="pane tree-pane">
      <div className="pane-header">Folders</div>
      <div
        ref={(node) => {
          setRootDropRef(node);
          if (typeof paneBodyRef === "function") {
            paneBodyRef(node);
          } else if (paneBodyRef && "current" in paneBodyRef) {
            paneBodyRef.current = node;
          }
        }}
        className={`pane-body tree-root${isOver ? " drop-inside" : ""}`}
        tabIndex={0}
        onKeyDown={onPaneKeyDown}
        onClick={(event) => {
          if (onPaneClick) {
            onPaneClick();
          }
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
            onContextMenu={onContextMenu}
            indentationWidth={indentationWidth}
          />
        ))}
      </div>
    </div>
  );
}

export { DROP_PREFIX, ROOT_ID, dropId };
