import type { CSSProperties, MouseEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DragData } from "../types";

type SortableTreeItemProps = {
  id: string;
  value: string;
  depth: number;
  indentationWidth: number;
  collapsed?: boolean;
  hasChildren?: boolean;
  indicator?: boolean;
  clone?: boolean;
  childCount?: number;
  selected?: boolean;
  renaming?: boolean;
  renameValue?: string;
  onRenameChange?: (value: string) => void;
  onRenameSubmit?: () => void;
  onRenameCancel?: () => void;
  onRenameStart?: () => void;
  onCollapse?: () => void;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onMoveOut?: () => void;
  onClick?: (event: MouseEvent) => void;
};

export function SortableTreeItem({
  id,
  value,
  depth,
  indentationWidth,
  collapsed,
  hasChildren,
  indicator,
  clone,
  childCount,
  selected,
  renaming,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onRenameStart,
  onCollapse,
  onRemove,
  onMoveUp,
  onMoveDown,
  onMoveOut,
  onClick,
}: SortableTreeItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
      id,
      data: { type: "folder", path: id } satisfies DragData,
      disabled: clone,
    });

  const style: CSSProperties = {
    paddingLeft: 12 + depth * indentationWidth,
    transform: clone ? undefined : CSS.Transform.toString(transform),
    transition: clone ? undefined : transition,
  };

  return (
    <div
      ref={setNodeRef}
      className={`item-row folder-row ${selected ? "selected" : ""} ${
        indicator ? "drop-before" : ""
      } ${clone ? "drag-clone" : ""}`}
      style={style}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      <button
        className="icon-btn"
        onClick={(event) => {
          event.stopPropagation();
          if (onCollapse && hasChildren) {
            onCollapse();
          }
        }}
      >
        {hasChildren ? (collapsed ? "▸" : "▾") : "•"}
      </button>
      {renaming ? (
        <input
          className="rename-input"
          value={renameValue}
          autoFocus
          onChange={(event) => onRenameChange?.(event.target.value)}
          onBlur={onRenameSubmit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onRenameSubmit?.();
            }
            if (event.key === "Escape") {
              onRenameCancel?.();
            }
          }}
        />
      ) : (
        <span className="item-label">
          {value}
          {childCount ? <span className="child-count">{childCount}</span> : null}
        </span>
      )}
      {(onRemove || onRenameStart || onMoveUp || onMoveDown || onMoveOut) &&
        !renaming && (
        <div className="row-actions">
          {onMoveUp && (
            <button
              className="icon-btn"
              onClick={(event) => {
                event.stopPropagation();
                onMoveUp();
              }}
            >
              Up
            </button>
          )}
          {onMoveDown && (
            <button
              className="icon-btn"
              onClick={(event) => {
                event.stopPropagation();
                onMoveDown();
              }}
            >
              Down
            </button>
          )}
          {onMoveOut && (
            <button
              className="icon-btn"
              onClick={(event) => {
                event.stopPropagation();
                onMoveOut();
              }}
            >
              Up
            </button>
          )}
          {onRenameStart && (
            <button
              className="icon-btn"
              onClick={(event) => {
                event.stopPropagation();
                onRenameStart();
              }}
            >
              Rename
            </button>
          )}
          {onRemove && (
            <button
              className="icon-btn"
              onClick={(event) => {
                event.stopPropagation();
                onRemove();
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
