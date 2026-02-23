import { useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Mic, PenLine } from "lucide-react";
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
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>, notePath: string) => void;
  onPullCreate?: () => Promise<void>;
  onPullRefresh?: () => Promise<void>;
  emptyStateText?: string;
  createButtonLabel?: string;
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
  onContextMenu,
  onPullCreate,
  onPullRefresh,
  emptyStateText,
  createButtonLabel = "Create note",
}: MobileNotesScreenProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pullEnabled = Boolean(onPullCreate || onPullRefresh);

  const startPull = (clientY: number) => {
    const scrollTop = scrollRef.current?.scrollTop ?? 0;
    if (!pullEnabled || scrollTop > 0 || creating || refreshing) {
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
    const shouldCreate = pullDistance >= 74;
    const shouldRefresh = pullDistance >= 70;
    setPullDistance(0);
    if (onPullRefresh) {
      if (!shouldRefresh) {
        return;
      }
      setRefreshing(true);
      try {
        await onPullRefresh();
      } finally {
        setRefreshing(false);
      }
      return;
    }
    if (onPullCreate) {
      if (!shouldCreate) {
        return;
      }
      setCreating(true);
      try {
        await onPullCreate();
      } finally {
        setCreating(false);
      }
    }
  };

  if (notes.length === 0) {
    return (
      <div className="mobile-screen-empty with-action">
        <p>{emptyStateText || `No notes in ${folderTitle}.`}</p>
        <button type="button" className="mobile-primary-btn" onClick={onCreate}>
          {createButtonLabel}
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
      {pullEnabled ? (
        <div className="mobile-pull-indicator" style={{ height: pullDistance }}>
          {onPullRefresh
            ? refreshing
              ? "Refreshing..."
              : pullDistance >= 70
                ? "Release to refresh"
                : "Pull down to refresh"
            : creating
              ? "Creating note..."
              : pullDistance >= 74
                ? "Release to create note"
                : "Pull down to create note"}
        </div>
      ) : null}
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
          onContextMenu={onContextMenu}
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
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>, notePath: string) => void;
};

function SwipeableNoteRow({
  note,
  preview,
  isActive,
  onSelect,
  onDelete,
  onArchive,
  onLongPress,
  onContextMenu,
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

  const noteTitle = (preview?.title || "").trim();
  const accessibleTitle = noteTitle || "untitled note";
  const noteSubline = `${preview?.dateLabel || ""}${preview?.secondLine ? ` ${preview?.secondLine}` : ""}`.trim();

  return (
    <div className="mobile-note-row-shell">
      <div className="mobile-note-row-actions" aria-hidden>
        <button
          type="button"
          className="mobile-note-action archive"
          onClick={() => onArchive(note.path)}
          aria-label={`Archive ${accessibleTitle}`}
        >
          Archive
        </button>
        <button
          type="button"
          className="mobile-note-action delete"
          onClick={() => onDelete(note.path)}
          aria-label={`Delete ${accessibleTitle}`}
        >
          Delete
        </button>
      </div>

      <button
        type="button"
        className={`mobile-note-row${isActive ? " active" : ""}`}
        style={{ transform: `translateX(${offset}px)` }}
        aria-label={`Open note ${accessibleTitle}${noteSubline ? `. ${noteSubline}` : ""}`}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse") {
            setDragging(false);
            startRef.current = null;
            movedRef.current = false;
            longPressFiredRef.current = false;
            clearLongPress();
            return;
          }
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
        onContextMenu={(event) => {
          event.preventDefault();
          if (!onContextMenu) {
            return;
          }
          onContextMenu(event, note.path);
          setOffset(0);
        }}
      >
        <span className="mobile-note-title-wrap">
          {preview?.isRecording ? (
            <Mic size={12} className="mobile-note-recording-icon" />
          ) : preview?.isHandwriting ? (
            <PenLine size={12} className="mobile-note-recording-icon" />
          ) : null}
          <span className="mobile-note-title">{noteTitle}</span>
        </span>
        <span className="mobile-note-subline">
          <span>{preview?.dateLabel || ""}</span>
          {preview?.dateLabel && preview?.secondLine ? <span> · </span> : null}
          <span>{preview?.secondLine || ""}</span>
        </span>
      </button>
    </div>
  );
}
