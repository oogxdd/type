import { useRef, useState } from "react";
import type { NoteEntry } from "../../types";
import type { NotePreview } from "../../utils/format";

type MobileNotesScreenProps = {
  folderTitle: string;
  notes: NoteEntry[];
  previews: Record<string, NotePreview>;
  activeNote: string | null;
  onSelect: (notePath: string) => void;
  onCreate: () => void;
  onDelete: (notePath: string) => void;
  onArchive: (notePath: string) => void;
  onLongPress: (notePath: string) => void;
  onRefresh: () => Promise<void>;
};

export function MobileNotesScreen({
  folderTitle,
  notes,
  previews,
  activeNote,
  onSelect,
  onCreate,
  onDelete,
  onArchive,
  onLongPress,
  onRefresh,
}: MobileNotesScreenProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const startPull = (clientY: number) => {
    const scrollTop = scrollRef.current?.scrollTop ?? 0;
    if (scrollTop > 0 || refreshing) {
      touchStartYRef.current = null;
      return;
    }
    touchStartYRef.current = clientY;
  };

  const movePull = (clientY: number) => {
    if (touchStartYRef.current == null) {
      return;
    }
    const delta = clientY - touchStartYRef.current;
    if (delta <= 0) {
      setPullDistance(0);
      return;
    }
    setPullDistance(Math.min(96, delta * 0.55));
  };

  const endPull = async () => {
    if (touchStartYRef.current == null) {
      return;
    }
    touchStartYRef.current = null;
    const shouldRefresh = pullDistance >= 64;
    setPullDistance(0);
    if (!shouldRefresh) {
      return;
    }
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  if (notes.length === 0) {
    return (
      <div className="mobile-screen-empty with-action">
        <p>No notes in {folderTitle}.</p>
        <button type="button" className="mobile-primary-btn" onClick={onCreate}>
          Create note
        </button>
      </div>
    );
  }

  return (
    <div
      className="mobile-screen-scroll"
      ref={scrollRef}
      onTouchStart={(event) => startPull(event.touches[0]?.clientY ?? 0)}
      onTouchMove={(event) => movePull(event.touches[0]?.clientY ?? 0)}
      onTouchEnd={() => {
        void endPull();
      }}
      onTouchCancel={() => {
        touchStartYRef.current = null;
        setPullDistance(0);
      }}
      aria-label="Notes list"
    >
      <div className="mobile-pull-indicator" style={{ height: pullDistance }}>
        {refreshing ? "Refreshing..." : pullDistance >= 64 ? "Release to refresh" : "Pull to refresh"}
      </div>
      {notes.map((note) => (
        <SwipeableNoteRow
          key={note.path}
          note={note}
          preview={previews[note.path]}
          isActive={activeNote === note.path}
          onSelect={onSelect}
          onDelete={onDelete}
          onArchive={onArchive}
          onLongPress={onLongPress}
        />
      ))}
    </div>
  );
}

type SwipeableNoteRowProps = {
  note: NoteEntry;
  preview?: NotePreview;
  isActive: boolean;
  onSelect: (notePath: string) => void;
  onDelete: (notePath: string) => void;
  onArchive: (notePath: string) => void;
  onLongPress: (notePath: string) => void;
};

function SwipeableNoteRow({
  note,
  preview,
  isActive,
  onSelect,
  onDelete,
  onArchive,
  onLongPress,
}: SwipeableNoteRowProps) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const noteTitle = preview?.title || note.name.replace(/\.md$/i, "");
  const noteSubline = `${preview?.dateLabel || ""}${preview?.secondLine ? ` ${preview?.secondLine}` : ""}`.trim();

  return (
    <div className="mobile-note-row-shell">
      <div className="mobile-note-row-actions" aria-hidden>
        <button
          type="button"
          className="mobile-note-action archive"
          onClick={() => onArchive(note.path)}
          aria-label={`Archive ${noteTitle}`}
        >
          Archive
        </button>
        <button
          type="button"
          className="mobile-note-action delete"
          onClick={() => onDelete(note.path)}
          aria-label={`Delete ${noteTitle}`}
        >
          Delete
        </button>
      </div>

      <button
        type="button"
        className={`mobile-note-row${isActive ? " active" : ""}`}
        style={{ transform: `translateX(${offset}px)` }}
        aria-label={`Open note ${noteTitle}${noteSubline ? `. ${noteSubline}` : ""}`}
        onPointerDown={(event) => {
          startRef.current = { x: event.clientX, y: event.clientY };
          movedRef.current = false;
          longPressFiredRef.current = false;
          setDragging(true);
          clearLongPress();
          longPressTimerRef.current = window.setTimeout(() => {
            longPressFiredRef.current = true;
            onLongPress(note.path);
          }, 500);
        }}
        onPointerMove={(event) => {
          const start = startRef.current;
          if (!dragging || !start) {
            return;
          }
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.abs(dx) > 7 || Math.abs(dy) > 7) {
            movedRef.current = true;
            clearLongPress();
          }
          if (Math.abs(dx) < Math.abs(dy)) {
            return;
          }
          const next = Math.max(-126, Math.min(0, dx));
          setOffset(next);
        }}
        onPointerUp={() => {
          clearLongPress();
          if (dragging) {
            setDragging(false);
            setOffset((current) => (current <= -56 ? -126 : 0));
          }
        }}
        onPointerLeave={() => {
          clearLongPress();
          if (dragging) {
            setDragging(false);
            setOffset((current) => (current <= -56 ? -126 : 0));
          }
        }}
        onPointerCancel={() => {
          clearLongPress();
          setDragging(false);
          setOffset(0);
        }}
        onClick={() => {
          if (longPressFiredRef.current) {
            longPressFiredRef.current = false;
            return;
          }
          if (movedRef.current) {
            return;
          }
          setOffset(0);
          onSelect(note.path);
        }}
      >
        <span className="mobile-note-title">{noteTitle}</span>
        <span className="mobile-note-subline">
          <span>{preview?.dateLabel || ""}</span>
          {preview?.dateLabel && preview?.secondLine ? <span> · </span> : null}
          <span>{preview?.secondLine || ""}</span>
        </span>
      </button>
    </div>
  );
}
