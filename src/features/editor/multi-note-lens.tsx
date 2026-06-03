import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type FormEvent as ReactFormEvent,
} from "react";
import { Brush, Eye, EyeOff, MessageSquarePlus, X } from "lucide-react";
import { readNote, writeNote } from "@/data/notes-api";
import { NoteReadonlyContent } from "./note-readonly-content";
import { sanitizeRecordingEditorContent } from "@/utils/format";
import { stripFrontmatter } from "@/utils/frontmatter";
import {
  parseNoteAnnotations,
  stripInlineAnnotationMetadata,
  withNoteAnnotations,
  type NoteAnnotationAnchor,
  type NoteAnnotationPoint,
  type NoteAnnotationsPayload,
} from "./note-annotations";

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
  annotations: NoteAnnotationsPayload;
};

type ActiveDrawing = {
  notePath: string;
  pointerId: number;
  points: NoteAnnotationPoint[];
};

type PendingTextDraft = {
  notePath: string;
  point: NoteAnnotationPoint;
  anchor: NoteAnnotationAnchor | null;
  text: string;
};

type AnchorCandidate = {
  hash: string;
  snippet: string;
  index: number;
  centerY: number;
};

const DRAW_TOOL = "draw" as const;
const TEXT_TOOL = "text" as const;
type LensTool = typeof DRAW_TOOL | typeof TEXT_TOOL;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const pointsToSvgPath = (points: NoteAnnotationPoint[]) =>
  points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x * 100} ${point.y * 100}`)
    .join(" ");

let markCounter = 0;
const buildId = () => {
  markCounter = (markCounter + 1) % 1_679_616;
  return `${Date.now().toString(36)}-${markCounter.toString(36)}`;
};

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

const isWithinInlineTextEditor = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest(".multi-lens-inline-text-editor"));

const textBlockSelector =
  ".tiptap-content p, .tiptap-content li, .tiptap-content blockquote, .tiptap-content h1, .tiptap-content h2, .tiptap-content h3";

const normalizeAnchorText = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const shortAnchorSnippet = (value: string) => normalizeAnchorText(value).slice(0, 80);

const hashAnchorText = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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
  const [pendingTextDraft, setPendingTextDraft] = useState<PendingTextDraft | null>(null);
  const [anchorCandidatesByNote, setAnchorCandidatesByNote] = useState<
    Record<string, AnchorCandidate[]>
  >({});

  const loadedNotesRef = useRef<LoadedLensNote[]>([]);
  const noteReadonlyRefMap = useRef<Record<string, HTMLDivElement | null>>({});
  const saveChainsRef = useRef<Record<string, Promise<void>>>({});
  const saveMessageTimerRef = useRef<number | null>(null);
  const textDraftRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (notes.length === 0) {
      loadedNotesRef.current = [];
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
        const cleanBodyMarkdown = stripInlineAnnotationMetadata(bodyMarkdown);
        const displayMarkdown = note.isRecording
          ? sanitizeRecordingEditorContent(cleanBodyMarkdown, note.transcriptionStatus)
          : cleanBodyMarkdown;
        return {
          ...note,
          rawMarkdown,
          displayMarkdown,
          annotations: parseNoteAnnotations(rawMarkdown),
        } satisfies LoadedLensNote;
      })
    )
      .then((next) => {
        if (cancelled) {
          return;
        }
        loadedNotesRef.current = next;
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
    loadedNotesRef.current = loadedNotes;
  }, [loadedNotes]);

  useEffect(() => {
    return () => {
      if (saveMessageTimerRef.current) {
        window.clearTimeout(saveMessageTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!pendingTextDraft) {
      return;
    }
    textDraftRef.current?.focus();
  }, [pendingTextDraft]);

  const collectAnchorCandidates = useCallback(() => {
    const next: Record<string, AnchorCandidate[]> = {};

    loadedNotes.forEach((note) => {
      const readonlyRoot = noteReadonlyRefMap.current[note.path];
      if (!readonlyRoot) {
        return;
      }
      const stage = readonlyRoot.closest(".multi-lens-note-stage");
      if (!(stage instanceof HTMLElement)) {
        return;
      }

      const stageRect = stage.getBoundingClientRect();
      if (!stageRect.height) {
        return;
      }

      const blocks = Array.from(
        readonlyRoot.querySelectorAll<HTMLElement>(textBlockSelector)
      );
      const anchors: AnchorCandidate[] = [];
      blocks.forEach((block) => {
        const normalized = normalizeAnchorText(block.textContent || "");
        if (!normalized) {
          return;
        }
        const blockRect = block.getBoundingClientRect();
        const centerY = clamp01(
          (blockRect.top + blockRect.height / 2 - stageRect.top) / stageRect.height
        );
        anchors.push({
          hash: hashAnchorText(normalized),
          snippet: shortAnchorSnippet(normalized),
          index: anchors.length,
          centerY,
        });
      });

      next[note.path] = anchors;
    });

    return next;
  }, [loadedNotes]);

  useEffect(() => {
    const refresh = () => setAnchorCandidatesByNote(collectAnchorCandidates());
    const frame = window.requestAnimationFrame(refresh);
    window.addEventListener("resize", refresh);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", refresh);
    };
  }, [collectAnchorCandidates]);

  const buildAnchorForPoint = useCallback(
    (notePath: string, y: number): NoteAnnotationAnchor | null => {
      const candidates = anchorCandidatesByNote[notePath] || [];
      if (candidates.length === 0) {
        return null;
      }
      let best = candidates[0];
      let bestDistance = Math.abs(best.centerY - y);
      for (let index = 1; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        const distance = Math.abs(candidate.centerY - y);
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }
      return {
        hash: best.hash,
        snippet: best.snippet,
        index: best.index,
        y: best.centerY,
      };
    },
    [anchorCandidatesByNote]
  );

  const resolveAnchorDelta = useCallback(
    (notePath: string, anchor?: NoteAnnotationAnchor | null) => {
      if (!anchor) {
        return 0;
      }
      const candidates = anchorCandidatesByNote[notePath] || [];
      if (candidates.length === 0) {
        return 0;
      }

      let match = candidates.find((candidate) => candidate.hash === anchor.hash);
      if (!match && anchor.snippet) {
        const normalizedSnippet = shortAnchorSnippet(anchor.snippet);
        match = candidates.find((candidate) => candidate.snippet === normalizedSnippet);
      }
      if (!match) {
        match = candidates.find((candidate) => candidate.index === anchor.index);
      }
      if (!match) {
        return 0;
      }
      return match.centerY - anchor.y;
    },
    [anchorCandidatesByNote]
  );

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
          const nextSnapshot = loadedNotesRef.current.map((entry) =>
            entry.path === notePath
              ? {
                  ...entry,
                  rawMarkdown: nextMarkdown,
                }
              : entry
          );
          loadedNotesRef.current = nextSnapshot;
          setLoadedNotes(nextSnapshot);
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
      const currentSnapshot = loadedNotesRef.current;
      let nextPayload: NoteAnnotationsPayload | null = null;
      let found = false;
      const nextSnapshot = currentSnapshot.map((entry) => {
        if (entry.path !== notePath) {
          return entry;
        }
        found = true;
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
      });

      if (!found || !nextPayload) {
        return;
      }

      loadedNotesRef.current = nextSnapshot;
      setLoadedNotes(nextSnapshot);
      queuePersist(notePath, nextPayload);
    },
    [queuePersist]
  );

  const addStroke = useCallback(
    (notePath: string, points: NoteAnnotationPoint[]) => {
      if (points.length < 2) {
        return;
      }
      const meanY = points.reduce((total, point) => total + point.y, 0) / points.length;
      const anchor = buildAnchorForPoint(notePath, meanY);
      patchAnnotations(notePath, (current) => ({
        ...current,
        strokes: [
          ...current.strokes,
          {
            id: buildId(),
            points,
            color: "#2b6ff0",
            width: 0.42,
            anchor,
            createdAt: Date.now(),
          },
        ],
      }));
    },
    [buildAnchorForPoint, patchAnnotations]
  );

  const commitDraft = useCallback(
    (draft: PendingTextDraft) => {
      const trimmed = draft.text.trim();
      if (!trimmed) {
        return;
      }
      patchAnnotations(draft.notePath, (current) => ({
        ...current,
        textNotes: [
          ...current.textNotes,
          {
            id: buildId(),
            x: draft.point.x,
            y: draft.point.y,
            text: trimmed,
            anchor: draft.anchor,
            createdAt: Date.now(),
          },
        ],
      }));
    },
    [patchAnnotations]
  );

  const commitPendingTextDraft = useCallback(() => {
    if (!pendingTextDraft) {
      return;
    }
    const trimmed = pendingTextDraft.text.trim();
    if (!trimmed) {
      setPendingTextDraft(null);
      return;
    }
    commitDraft(pendingTextDraft);
    setPendingTextDraft(null);
  }, [commitDraft, pendingTextDraft]);

  useEffect(() => {
    if (isAnnotating) {
      return;
    }
    setDrawing(null);
    if (pendingTextDraft && pendingTextDraft.text.trim()) {
      commitDraft(pendingTextDraft);
    }
    setPendingTextDraft(null);
  }, [commitDraft, isAnnotating, pendingTextDraft]);

  const addTextNote = useCallback(
    (notePath: string, point: NoteAnnotationPoint) => {
      if (pendingTextDraft && pendingTextDraft.text.trim()) {
        commitDraft(pendingTextDraft);
      }
      setPendingTextDraft({
        notePath,
        point,
        anchor: buildAnchorForPoint(notePath, point.y),
        text: "",
      });
    },
    [buildAnchorForPoint, commitDraft, pendingTextDraft]
  );

  const commitPendingTextDraftFromSubmit = useCallback(
    (event: ReactFormEvent<HTMLFormElement>) => {
      event.preventDefault();
      event.stopPropagation();
      commitPendingTextDraft();
    },
    [commitPendingTextDraft]
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
      if (isWithinInlineTextEditor(event.target)) {
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
            onClick={() => {
              if (pendingTextDraft && pendingTextDraft.text.trim()) {
                commitDraft(pendingTextDraft);
                setPendingTextDraft(null);
              }
              setIsAnnotating((previous) => !previous);
            }}
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
              onClick={() => {
                if (pendingTextDraft && pendingTextDraft.text.trim()) {
                  commitDraft(pendingTextDraft);
                  setPendingTextDraft(null);
                }
                onExitLens();
              }}
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
              const renderedStrokes = note.annotations.strokes.map((stroke) => {
                const deltaY = resolveAnchorDelta(note.path, stroke.anchor);
                if (!deltaY) {
                  return stroke;
                }
                return {
                  ...stroke,
                  points: stroke.points.map((point) => ({
                    x: point.x,
                    y: clamp01(point.y + deltaY),
                  })),
                };
              });
              const renderedTextNotes = note.annotations.textNotes.map((item) => {
                const deltaY = resolveAnchorDelta(note.path, item.anchor);
                if (!deltaY) {
                  return item;
                }
                return {
                  ...item,
                  y: clamp01(item.y + deltaY),
                };
              });

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
                    <div
                      className="multi-lens-note-readonly"
                      ref={(node) => {
                        noteReadonlyRefMap.current[note.path] = node;
                      }}
                    >
                      <NoteReadonlyContent markdown={note.displayMarkdown} />
                    </div>

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
                          {renderedStrokes.map((stroke) => (
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
                        {renderedTextNotes.map((item) => (
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
                        {pendingTextDraft && pendingTextDraft.notePath === note.path ? (
                          <form
                            className="multi-lens-inline-text-editor"
                            style={{
                              left: `${pendingTextDraft.point.x * 100}%`,
                              top: `${pendingTextDraft.point.y * 100}%`,
                            }}
                            onSubmit={commitPendingTextDraftFromSubmit}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <textarea
                              ref={textDraftRef}
                              className="multi-lens-inline-text-editor-input"
                              rows={1}
                              value={pendingTextDraft.text}
                              placeholder="Margin note..."
                              onChange={(event) =>
                                setPendingTextDraft((previous) =>
                                  previous
                                    ? {
                                        ...previous,
                                        text: event.target.value,
                                      }
                                    : previous
                                )
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  setPendingTextDraft(null);
                                }
                                if (event.key === "Enter" && !event.shiftKey) {
                                  event.preventDefault();
                                  commitPendingTextDraft();
                                }
                              }}
                            />
                            <div className="multi-lens-inline-text-editor-actions">
                              <button
                                type="button"
                                className="multi-lens-inline-text-editor-action"
                                onClick={() => setPendingTextDraft(null)}
                              >
                                Cancel
                              </button>
                              <button
                                type="submit"
                                className="multi-lens-inline-text-editor-action primary"
                                disabled={!pendingTextDraft.text.trim()}
                              >
                                Save
                              </button>
                            </div>
                          </form>
                        ) : null}
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
