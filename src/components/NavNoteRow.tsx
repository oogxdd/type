import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { DragData, NoteEntry } from "../types";
import type { NotePreview } from "../utils/format";

export type NavNoteRowProps = {
  note: NoteEntry;
  preview?: NotePreview;
  parentPath: string;
  depth: number;
  indentationWidth: number;
  isSelected: boolean;
  onSelect: (notePath: string, event: ReactMouseEvent, parentPath: string) => void;
  onContextMenu: (
    event: ReactMouseEvent,
    notePath: string,
    parentPath: string
  ) => void;
};

export function NavNoteRow({
  note,
  preview,
  parentPath,
  depth,
  indentationWidth,
  isSelected,
  onSelect,
  onContextMenu,
}: NavNoteRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: note.path,
    data: { type: "note", path: note.path } satisfies DragData,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: note.path,
    data: { type: "note", path: note.path } satisfies DragData,
  });
  const setRefs = useCallback(
    (element: HTMLDivElement | null) => {
      setNodeRef(element);
      setDropRef(element);
    },
    [setDropRef, setNodeRef]
  );
  const style = {
    transform: isDragging ? undefined : CSS.Translate.toString(transform),
    paddingLeft: 12 + depth * indentationWidth,
  } as React.CSSProperties;
  const title = preview?.title || "";

  return (
    <div
      ref={setRefs}
      style={style}
      className={`item-row nav-note-row${isSelected ? " selected" : ""}${
        isOver ? " drop-inside" : ""
      }${isDragging ? " is-dragging" : ""}`}
      data-note={note.path}
      onClick={(event) => onSelect(note.path, event, parentPath)}
      onContextMenu={(event) => onContextMenu(event, note.path, parentPath)}
      {...listeners}
      {...attributes}
    >
      <span className="icon-spacer" aria-hidden />
      <span className="nav-note-glyph" aria-hidden>
        <svg viewBox="0 0 24 24">
          <path
            d="M7 3.8h7l3.2 3.2V19a1.2 1.2 0 0 1-1.2 1.2H7A1.2 1.2 0 0 1 5.8 19V5A1.2 1.2 0 0 1 7 3.8z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M13.9 3.8V7h3.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="item-label">{title}</span>
    </div>
  );
}
