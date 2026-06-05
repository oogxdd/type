import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type FormEvent as ReactFormEvent,
} from "react";
import { readNote, writeNote } from "@/features/notes/api/notes-api";
import { confirmAction } from "@/shared/lib/dom";
import { sanitizeRecordingEditorContent } from "@/shared/lib/format";
import { stripFrontmatter } from "@/shared/lib/frontmatter";
import {
  parseNoteAnnotations,
  stripInlineAnnotationMetadata,
  withNoteAnnotations,
  type NoteAnnotationAnchor,
  type NoteAnnotationPoint,
  type NoteAnnotationsPayload,
} from "../lib/note-annotations";
import {
  buildId,
  clamp01,
  DRAW_TOOL,
  getOverlayPoint,
  hashAnchorText,
  isWithinInlineTextEditor,
  normalizeAnchorText,
  shortAnchorSnippet,
  TEXT_BLOCK_SELECTOR,
  TEXT_TOOL,
  type LensTool,
} from "../lib/lens-geometry";
import { getErrorMessage } from "@/shared/lib/errors";

export type LensNote = {
  path: string;
  title: string;
  dateLabel: string;
  isRecording: boolean;
  transcriptionStatus: string | null;
};

export type LoadedLensNote = LensNote & {
  rawMarkdown: string;
  displayMarkdown: string;
  annotations: NoteAnnotationsPayload;
};

export type PendingTextDraft = {
  notePath: string;
  point: NoteAnnotationPoint;
  anchor: NoteAnnotationAnchor | null;
  text: string;
};

type ActiveDrawing = {
  notePath: string;
  pointerId: number;
  points: NoteAnnotationPoint[];
};

type AnchorCandidate = {
  hash: string;
  snippet: string;
  index: number;
  centerY: number;
};

type UseLensAnnotationsArgs = {
  notes: LensNote[];
  activeNote: string | null;
  onBeforePersist?: () => Promise<void>;
  onActiveNoteContentSync?: (markdown: string) => void;
};

/**
 * Owns all multi-note lens annotation state: loading note bodies, tracking
 * strokes/text-notes per note, anchoring marks to nearby text blocks, and
 * persisting changes back to disk through a per-note serialized save chain.
 * The lens components are purely presentational on top of this.
 */
export function useLensAnnotations({
  notes,
  activeNote,
  onBeforePersist,
  onActiveNoteContentSync,
}: UseLensAnnotationsArgs) {
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
        const message = getErrorMessage(error);
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

      const blocks = Array.from(readonlyRoot.querySelectorAll<HTMLElement>(TEXT_BLOCK_SELECTOR));
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
          const message = getErrorMessage(error);
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
    (notePath: string, patcher: (current: NoteAnnotationsPayload) => NoteAnnotationsPayload) => {
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

  // Commit a non-empty draft without clearing an empty one — used when toggling
  // annotate mode or exiting the lens.
  const commitPendingDraftIfAny = useCallback(() => {
    if (pendingTextDraft && pendingTextDraft.text.trim()) {
      commitDraft(pendingTextDraft);
      setPendingTextDraft(null);
    }
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
    async (notePath: string) => {
      const shouldClear = await confirmAction(
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
        if (lastPoint && Math.hypot(lastPoint.x - point.x, lastPoint.y - point.y) < 0.002) {
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

  const setPendingTextDraftText = useCallback((text: string) => {
    setPendingTextDraft((previous) => (previous ? { ...previous, text } : previous));
  }, []);

  const cancelPendingTextDraft = useCallback(() => {
    setPendingTextDraft(null);
  }, []);

  const toggleAnnotationsVisible = useCallback(() => {
    setIsAnnotationsVisible((previous) => !previous);
  }, []);

  const toggleAnnotating = useCallback(() => {
    commitPendingDraftIfAny();
    setIsAnnotating((previous) => !previous);
  }, [commitPendingDraftIfAny]);

  const marksTotal = loadedNotes.reduce(
    (total, note) => total + note.annotations.strokes.length + note.annotations.textNotes.length,
    0
  );

  return {
    loadedNotes,
    isLoading,
    loadError,
    saveError,
    saveMessage,
    marksTotal,
    isAnnotationsVisible,
    isAnnotating,
    tool,
    drawing,
    pendingTextDraft,
    noteReadonlyRefMap,
    textDraftRef,
    setTool,
    toggleAnnotationsVisible,
    toggleAnnotating,
    commitPendingDraftIfAny,
    resolveAnchorDelta,
    clearAnnotations,
    handleOverlayPointerDown,
    handleOverlayPointerMove,
    handleOverlayPointerEnd,
    setPendingTextDraftText,
    cancelPendingTextDraft,
    commitPendingTextDraft,
    commitPendingTextDraftFromSubmit,
  };
}

export type LensAnnotations = ReturnType<typeof useLensAnnotations>;
