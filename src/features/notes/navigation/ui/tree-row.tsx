import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays } from "lucide-react";
import type { TreeItem } from "../model/types";
import type { DragData } from "@/shared/types";
import { dropId } from "../model/tree-dnd";

export type TreeRowProps = {
  node: TreeItem;
  depth: number;
  isSelected: boolean;
  hasNestedItems: boolean;
  edgePosition: "before" | "after" | null;
  isCollapsed: boolean;
  onSelect: (event: ReactMouseEvent, id: string) => void;
  onToggle: (event: ReactMouseEvent, id: string) => void;
  renaming: boolean;
  renameValue: string;
  setRenameValue: (value: string) => void;
  submitRenameFolder: () => void;
  cancelRenameFolder: () => void;
  onContextMenu: (event: ReactMouseEvent, id: string) => void;
  indentationWidth: number;
  draggable?: boolean;
  feedMode?: boolean;
  renamingEnabled?: boolean;
};

export function TreeRow({
  node,
  depth,
  isSelected,
  hasNestedItems,
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
  draggable = true,
  feedMode = false,
  renamingEnabled = true,
}: TreeRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: node.id,
    data: { type: "folder", path: node.id } satisfies DragData,
    disabled: !draggable,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dropId(node.id, "inside"),
    data: { type: "folder", path: node.id } satisfies DragData,
    disabled: !draggable,
  });

  const setRefs = useCallback(
    (element: HTMLDivElement | null) => {
      setNodeRef(element);
      setDropRef(element);
    },
    [setNodeRef, setDropRef]
  );

  const style = {
    transform: isDragging ? undefined : CSS.Translate.toString(transform),
    paddingLeft: 12 + depth * indentationWidth,
  } as React.CSSProperties;
  const guideBaseLeft = 12 + 20 + 6 + 8;

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
        onSelect(event, node.id);
      }}
      onContextMenu={(event) => {
        onContextMenu(event, node.id);
      }}
      {...listeners}
      {...attributes}
    >
      {depth > 0 && (
        <span className="tree-guides" aria-hidden>
          {Array.from({ length: depth }, (_, index) => (
            <span
              key={`depth-${index}`}
              className="tree-guide-vert"
              style={{ left: guideBaseLeft + index * indentationWidth }}
            />
          ))}
        </span>
      )}
      {hasNestedItems ? (
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
          {feedMode ? (
            <CalendarDays size={15} />
          ) : hasNestedItems && !isCollapsed ? (
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
      {renaming && renamingEnabled ? (
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
