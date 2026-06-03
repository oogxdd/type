import { useSortable } from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Mic, PenLine } from "lucide-react";
import type { DragData, NoteEntry } from "@/shared/types";
import type { NotePreview } from "@/shared/lib/format";

export function NoteRow({
  note,
  preview,
  isSelected,
  onClick,
  onContextMenu,
}: {
  note: NoteEntry;
  preview?: NotePreview;
  isSelected: boolean;
  onClick: (notePath: string, event: ReactMouseEvent) => void;
  onContextMenu: (event: ReactMouseEvent, path: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: note.path,
      data: { type: "note", path: note.path } satisfies DragData,
    });

  const style: React.CSSProperties = {
    transform: !isDragging ? DndCSS.Transform.toString(transform) : undefined,
    transition: !isDragging ? transition : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      className={`item-row note-row transition-colors ${isSelected ? "selected" : ""}`}
      style={style}
      data-note={note.path}
      onClick={(event) => onClick(note.path, event)}
      onContextMenu={(event) => onContextMenu(event, note.path)}
      {...attributes}
      {...listeners}
    >
      <div className="note-row-main">
        <div className="note-row-title-wrap">
          {preview?.isRecording ? (
            <Mic size={12} className="note-row-recording-icon" />
          ) : preview?.isHandwriting ? (
            <PenLine size={12} className="note-row-recording-icon" />
          ) : null}
          <div className="note-row-title">{preview?.title || ""}</div>
        </div>
        <div className="note-row-subline">
          <span className="note-row-date">{preview?.dateLabel || ""}</span>
          {preview?.dateLabel && preview?.secondLine && (
            <span className="note-row-dot"> </span>
          )}
          <span className="note-row-snippet">{preview?.secondLine || ""}</span>
        </div>
      </div>
    </div>
  );
}
