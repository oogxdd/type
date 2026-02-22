import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Brush, Eye, EyeOff, MessageSquarePlus, X } from "lucide-react";
import { marked } from "marked";
import { readNote, writeNote } from "../data/notesApi";
import { sanitizeRecordingEditorContent } from "../utils/format";
import { stripFrontmatter } from "../utils/frontmatter";
import {
  parseNoteAnnotations,
  withNoteAnnotations,
  type NoteAnnotationPoint,
  type NoteAnnotationsPayload,
} from "../utils/noteAnnotations";

type LensNote = {
  path: string;
  title: string;
  dateLabel: string;
  isRecording: boolean;
  transcriptionStatus: string | null;
};

type MultiNoteLensProps = {
  notes: LensNote[];
  activeNote: string | null;
  onBeforePersist?: () => Promise<void>;
  onActiveNoteContentSync?: (markdown: string) => void;
  onExitLens?: () => void;
};

type LoadedLensNote = LensNote & {
  rawMarkdown: string;
  displayMarkdown: string;
  html: string;
  annotations: NoteAnnotationsPayload;
};

type ActiveDrawing = {
  notePath: string;
  pointerId: number;
  points: NoteAnnotationPoint[];
};

const DRAW_TOOL = "draw" as const;
const TEXT_TOOL = "text" as const;
type LensTool = typeof DRAW_TOOL | typeof TEXT_TOOL;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const toHtml = (markdown: string) => {
  const parsed = marked.parse(markdown || "", {
    breaks: true,
    gfm: true,
  });
  return typeof parsed === "string" ? parsed : "";
};

const pointsToSvgPath = (points: NoteAnnotationPoint[]) =>
  points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x * 100} ${point.y * 100}`)
    .join(" ");

const buildId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `lens-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const getOverlayPoint = (event: ReactPointerEvent<HTMLDivElement>): NoteAnnotationPoint | null => {
  const rect = event.currentTarget.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }
  return {
    x: clamp01((event.clientX - rect.left) / rect.width),
    y: clamp01((event.clientY - rect.top) / rect.height),
  };
};

export function MultiNoteLens({
  notes,
  activeNote,
  onBeforePersist,
  onActiveNoteContentSync,
  onExitLens,
}: MultiNoteLensProps) {
  const [loadedNotes, setLoadedNotes] = useState<LoadedLensNote[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isAnnotationsVisible, setIsAnnotationsVisible] = useState(true);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [tool, setTool] = useState<LensTool>(DRAW_TOOL);
  const [drawing, setDrawing] = useState<ActiveDrawing | null>(null);

  const saveChainsRef = useRef<Record<string, Promise<void>>>({});
  const saveMessageTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (notes.length === 0) {
      setLoadedNotes([]);
      setIsLoading(false);
      setLoadError(null);
      return () => {
        cancelled = true;
      };
    }

    setIsLoading(true);
    setLoadError(null);
    Promise.all(
      notes.map(async (note) => {
        const rawMarkdown = await readNote(note.path);
        const bodyMarkdown = stripFrontmatter(rawMarkdown);
        const displayMarkdown = note.isRecording
          ? sanitizeRecordingEditorContent(bodyMarkdown, note.transcriptionStatus)
          : bodyMarkdown;
        return {
          ...note,
          rawMarkdown,
          displayMarkdown,
          html: toHtml(displayMarkdown),
          annotations: parseNoteAnnotations(rawMarkdown),
        } satisfies LoadedLensNote;
      })
    )
      .then((next) => {
        if (cancelled) {
          return;
        }
        setLoadedNotes(next);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setLoadError(message);
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [notes]);

  useEffect(() => {
    return () => {
      if (saveMessageTimerRef.current) {
        window.clearTimeout(saveMessageTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isAnnotating) {
      setDrawing(null);
    }
  }, [isAnnotating]);

  const queuePersist = useCallback(
    (notePath: string, annotations: NoteAnnotationsPayload) => {
      const run = async () => {
        try {
          setSaveError(null);
          setSaveMessage("Saving marks...");
          if (onBeforePersist) {
            await onBeforePersist();
          }
          const latestMarkdown = await readNote(notePath);
          const nextMarkdown = withNoteAnnotations(latestMarkdown, annotations);
          await writeNote(notePath, nextMarkdown);
          setLoadedNotes((previous) =>
            previous.map((entry) =>
              entry.path === notePath
                ? {
                    ...entry,
                    rawMarkdown: nextMarkdown,
                  }
                : entry
            )
          );
          if (activeNote === notePath && onActiveNoteContentSync) {
            onActiveNoteContentSync(nextMarkdown);
          }
          setSaveMessage("Marks saved");
          if (saveMessageTimerRef.current) {
            window.clearTimeout(saveMessageTimerRef.current);
          }
          saveMessageTimerRef.current = window.setTimeout(() => {
            setSaveMessage(null);
          }, 1200);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setSaveError(message);
          setSaveMessage(null);
        }
      };

      const previousChain = saveChainsRef.current[notePath] || Promise.resolve();
      saveChainsRef.current[notePath] = previousChain.catch(() => undefined).then(run);
    },
    [activeNote, onActiveNoteContentSync, onBeforePersist]
  );

  const patchAnnotations = useCallback(
    (
      notePath: string,
      patcher: (current: NoteAnnotationsPayload) => NoteAnnotationsPayload
    ) => {
      let nextPayload: NoteAnnotationsPayload | null = null;
      setLoadedNotes((previous) =>
        previous.map((entry) => {
          if (entry.path !== notePath) {
            return entry;
          }
          const patched = patcher(entry.annotations);
          const nextEntryPayload: NoteAnnotationsPayload = {
            ...patched,
            updatedAt: Date.now(),
          };
          nextPayload = nextEntryPayload;
          return {
            ...entry,
            annotations: nextEntryPayload,
          };
        })
      );
      if (nextPayload) {
        queuePersist(notePath, nextPayload);
      }
    },
    [queuePersist]
  );

  const addStroke = useCallback(
    (notePath: string, points: NoteAnnotationPoint[]) => {
      if (points.length < 2) {
        return;
      }
      patchAnnotations(notePath, (current) => ({
        ...current,
        strokes: [
          ...current.strokes,
          {
            id: buildId(),
            points,
            color: "#2b6ff0",
            width: 0.42,
            createdAt: Date.now(),
          },
        ],
      }));
    },
    [patchAnnotations]
  );

  const addTextNote = useCallback(
    (notePath: string, point: NoteAnnotationPoint) => {
      const text = window.prompt("New margin note");
      const trimmed = text?.trim();
      if (!trimmed) {
        return;
      }
      patchAnnotations(notePath, (current) => ({
        ...current,
        textNotes: [
          ...current.textNotes,
          {
            id: buildId(),
            x: point.x,
            y: point.y,
            text: trimmed,
            createdAt: Date.now(),
          },
        ],
      }));
    },
    [patchAnnotations]
  );

  const clearAnnotations = useCallback(
    (notePath: string) => {
      const shouldClear = window.confirm(
        "Clear all marks for this note? This cannot be undone."
      );
      if (!shouldClear) {
        return;
      }
      patchAnnotations(notePath, (current) => ({
        ...current,
        strokes: [],
        textNotes: [],
      }));
    },
    [patchAnnotations]
  );

  const handleOverlayPointerDown = useCallback(
    (notePath: string, event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isAnnotating || event.button !== 0) {
        return;
      }
      const point = getOverlayPoint(event);
      if (!point) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      if (tool === TEXT_TOOL) {
        addTextNote(notePath, point);
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      setDrawing({
        notePath,
        pointerId: event.pointerId,
        points: [point],
      });
    },
    [addTextNote, isAnnotating, tool]
  );

  const handleOverlayPointerMove = useCallback(
    (notePath: string, event: ReactPointerEvent<HTMLDivElement>) => {
      if (!drawing || drawing.notePath !== notePath || drawing.pointerId !== event.pointerId) {
        return;
      }
      const point = getOverlayPoint(event);
      if (!point) {
        return;
      }
      setDrawing((previous) => {
        if (
          !previous ||
          previous.notePath !== notePath ||
          previous.pointerId !== event.pointerId
        ) {
          return previous;
        }
        const lastPoint = previous.points[previous.points.length - 1];
        if (
          lastPoint &&
          Math.hypot(lastPoint.x - point.x, lastPoint.y - point.y) < 0.002
        ) {
          return previous;
        }
        return {
          ...previous,
          points: [...previous.points, point],
        };
      });
    },
    [drawing]
  );

  const handleOverlayPointerEnd = useCallback(
    (notePath: string, event: ReactPointerEvent<HTMLDivElement>) => {
      if (!drawing || drawing.notePath !== notePath || drawing.pointerId !== event.pointerId) {
        return;
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      addStroke(notePath, drawing.points);
      setDrawing(null);
    },
    [addStroke, drawing]
  );

  const marksTotal = loadedNotes.reduce(
    (total, note) => total + note.annotations.strokes.length + note.annotations.textNotes.length,
    0
  );

  return (
    <div className="multi-lens-shell">
      <div className="multi-lens-toolbar">
        <div className="multi-lens-toolbar-main">
          <h3 className="multi-lens-title">
            {loadedNotes.length > 1 ? `${loadedNotes.length} notes in lens` : "Lens view"}
          </h3>
          <p className="multi-lens-subtitle">
            {isAnnotating
              ? "Draw over content and add margin notes. Marks are saved per note."
              : "Read selected notes combined. Toggle marks visibility with Lens controls."}
          </p>
        </div>
        <div className="multi-lens-toolbar-actions">
          <button
            type="button"
            className="multi-lens-btn"
            onClick={() => setIsAnnotationsVisible((previous) => !previous)}
          >
            {isAnnotationsVisible ? <EyeOff size={14} /> : <Eye size={14} />}
            <span>{isAnnotationsVisible ? "Hide marks" : "Show marks"}</span>
          </button>
          <button
            type="button"
            className={`multi-lens-btn ${isAnnotating ? "active" : ""}`}
            onClick={() => setIsAnnotating((previous) => !previous)}
          >
            <Brush size={14} />
            <span>{isAnnotating ? "Stop marking" : "Mark up"}</span>
          </button>
          {isAnnotating ? (
            <>
              <button
                type="button"
                className={`multi-lens-btn icon ${tool === DRAW_TOOL ? "active" : ""}`}
                onClick={() => setTool(DRAW_TOOL)}
                aria-label="Draw tool"
                title="Draw tool"
              >
                <Brush size={14} />
              </button>
              <button
                type="button"
                className={`multi-lens-btn icon ${tool === TEXT_TOOL ? "active" : ""}`}
                onClick={() => setTool(TEXT_TOOL)}
                aria-label="Text note tool"
                title="Text note tool"
              >
                <MessageSquarePlus size={14} />
              </button>
            </>
          ) : null}
          {onExitLens ? (
            <button
              type="button"
              className="multi-lens-btn icon"
              onClick={onExitLens}
              aria-label="Close lens"
              title="Close lens"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="multi-lens-status-row">
        <span>{marksTotal} saved marks</span>
        {saveMessage ? <span>{saveMessage}</span> : null}
        {saveError ? <span className="error">{saveError}</span> : null}
        {loadError ? <span className="error">{loadError}</span> : null}
      </div>

      <div className="multi-lens-scroll">
        {isLoading ? <div className="empty">Loading selected notes...</div> : null}
        {!isLoading && loadedNotes.length === 0 ? (
          <div className="empty">Select one or more notes to open lens view.</div>
        ) : null}
        {!isLoading
          ? loadedNotes.map((note, index) => {
              const noteMarksCount =
                note.annotations.strokes.length + note.annotations.textNotes.length;
              const draftPath =
                drawing && drawing.notePath === note.path
                  ? pointsToSvgPath(drawing.points)
                  : null;

              return (
                <section className="multi-lens-note" key={note.path}>
                  <header className="multi-lens-note-header">
                    <div className="multi-lens-note-headline">
                      <h4>{note.title || note.path.split("/").pop() || note.path}</h4>
                      <p>
                        {note.path}
                        {note.dateLabel ? ` · ${note.dateLabel}` : ""}
                      </p>
                    </div>
                    <div className="multi-lens-note-actions">
                      <span>{noteMarksCount} marks</span>
                      <button
                        type="button"
                        className="multi-lens-btn subtle"
                        onClick={() => clearAnnotations(note.path)}
                        disabled={noteMarksCount === 0}
                      >
                        Clear
                      </button>
                    </div>
                  </header>

                  <div className="multi-lens-note-stage">
                    <article
                      className="tiptap-content multi-lens-markdown"
                      dangerouslySetInnerHTML={{ __html: note.html || "<p></p>" }}
                    />

                    {isAnnotationsVisible ? (
                      <div
                        className={`multi-lens-overlay ${isAnnotating ? "is-editing" : ""}`}
                        onPointerDown={(event) => handleOverlayPointerDown(note.path, event)}
                        onPointerMove={(event) => handleOverlayPointerMove(note.path, event)}
                        onPointerUp={(event) => handleOverlayPointerEnd(note.path, event)}
                        onPointerCancel={(event) => handleOverlayPointerEnd(note.path, event)}
                      >
                        <svg
                          className="multi-lens-strokes"
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                        >
                          {note.annotations.strokes.map((stroke) => (
                            <path
                              key={stroke.id}
                              d={pointsToSvgPath(stroke.points)}
                              fill="none"
                              stroke={stroke.color}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={stroke.width}
                            />
                          ))}
                          {draftPath ? (
                            <path
                              d={draftPath}
                              fill="none"
                              stroke="#2b6ff0"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={0.42}
                            />
                          ) : null}
                        </svg>
                        {note.annotations.textNotes.map((item) => (
                          <aside
                            className="multi-lens-text-note"
                            key={item.id}
                            style={{
                              left: `${item.x * 100}%`,
                              top: `${item.y * 100}%`,
                            }}
                          >
                            {item.text}
                          </aside>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {index < loadedNotes.length - 1 ? <div className="multi-lens-divider" /> : null}
                </section>
              );
            })
          : null}
      </div>
    </div>
  );
}
