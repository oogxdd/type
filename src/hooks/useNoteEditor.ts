import { useCallback, useEffect, useRef, useState } from "react";
import { deleteItems, readNote, renameItem, writeNote } from "../data/notesApi";
import type { NoteFileNameFormat } from "../types";
import { stripFrontmatter } from "../utils/frontmatter";
import { stripInlineAnnotationMetadata } from "../utils/noteAnnotations";

const UUID_V7_FILE_NAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}\.md$/i;
const UUID_V7_PREFIX_FILE_NAME_RE = /^([0-9a-f]{8}-[0-9a-f]{4})(?:-(.+))?\.md$/i;
const UTC_TIMESTAMP_FILE_NAME_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)(?:-(.+))?\.md$/i;
const MIN_SLUG_CONTENT_CHARS = 8;
const MAX_SLUG_WORDS = 8;
const MAX_SLUG_LENGTH = 56;
const NOISE_HASH_RE = /^[a-z0-9]{1,32}$/;
const PLACEHOLDER_SUFFIX_RE =
  /^(?:note|untitled|note-[0-9a-f-]{8,}|recording|recording-[0-9a-f-]{8,}|handwriting|handwriting-[0-9a-f-]{8,})$/i;

const emitTreeInvalidated = () => {
  window.dispatchEvent(new CustomEvent("notes-tree-invalidated"));
};

const stripNoiseTokenSequences = (tokens: string[]) => {
  const cleaned: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (
      i + 3 < tokens.length &&
      tokens[i] === "nv" &&
      tokens[i + 1] === "empty" &&
      tokens[i + 2] === "line" &&
      tokens[i + 3] === "token"
    ) {
      i += 3;
      if (i + 1 < tokens.length && NOISE_HASH_RE.test(tokens[i + 1])) {
        i += 1;
      }
      continue;
    }
    cleaned.push(tokens[i]);
  }
  return cleaned;
};

const buildSlugFromContent = (markdown: string) => {
  const normalized = stripInlineAnnotationMetadata(stripFrontmatter(markdown))
    .replace(/NV_EMPTY_LINE_TOKEN_[A-Za-z0-9]+/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+]\([^)]+\)/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[>\-*+]\s+/gm, "")
    .replace(/https?:\/\/\S+/gi, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }
  const tokens = normalized
    .split(" ")
    .filter((word) => word && !word.startsWith("http") && !word.startsWith("www"));
  const words = stripNoiseTokenSequences(tokens).slice(0, MAX_SLUG_WORDS);
  const slug = words.join("-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-$/g, "");
};

const getAutoRenameTarget = (
  notePath: string,
  content: string,
  noteFileNameFormat: NoteFileNameFormat
) => {
  const segments = notePath.split("/");
  const fileName = segments[segments.length - 1] || "";
  const slug = buildSlugFromContent(content);
  if (slug.replace(/-/g, "").length < MIN_SLUG_CONTENT_CHARS) {
    return null;
  }

  if (noteFileNameFormat === "uuid_v7") {
    return null;
  }

  if (noteFileNameFormat === "utc_timestamp_slug") {
    const timestampMatch = fileName.match(UTC_TIMESTAMP_FILE_NAME_RE);
    if (!timestampMatch) {
      return null;
    }
    const prefix = timestampMatch[1];
    const suffix = (timestampMatch[2] || "").toLowerCase();
    if (suffix && !PLACEHOLDER_SUFFIX_RE.test(suffix)) {
      return null;
    }
    const nextName = `${prefix}-${slug}.md`;
    return nextName.toLowerCase() === fileName.toLowerCase() ? null : nextName;
  }

  const prefixMatch = fileName.match(UUID_V7_PREFIX_FILE_NAME_RE);
  if (prefixMatch) {
    const prefix = (prefixMatch[1] || "").toLowerCase();
    const suffix = (prefixMatch[2] || "").toLowerCase();
    if (suffix && !PLACEHOLDER_SUFFIX_RE.test(suffix)) {
      return null;
    }
    const nextName = `${prefix}-${slug}.md`;
    return nextName.toLowerCase() === fileName.toLowerCase() ? null : nextName;
  }

  if (!UUID_V7_FILE_NAME_RE.test(fileName)) {
    return null;
  }
  const rootId = fileName.replace(/\.md$/i, "");
  const prefix = rootId.slice(0, 13);
  const nextName = `${prefix}-${slug}.md`;
  return nextName.toLowerCase() === fileName.toLowerCase() ? null : nextName;
};

export function useNoteEditor(
  activeNote: string | null,
  noteFileNameFormat: NoteFileNameFormat
) {
  const [noteContent, setNoteContent] = useState("");
  const [draftNoteContent, setDraftNoteContent] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const noteContentRef = useRef(noteContent);
  const activeNoteRef = useRef(activeNote);
  const noteDirtyRef = useRef(noteDirty);

  useEffect(() => {
    noteContentRef.current = noteContent;
  }, [noteContent]);

  useEffect(() => {
    noteDirtyRef.current = noteDirty;
  }, [noteDirty]);

  const saveNow = useCallback(
    async (targetNote: string | null, content: string) => {
      if (!targetNote) {
        return;
      }
      setIsSaving(true);
      setSaveError(null);
      try {
        await writeNote(targetNote, content);
        if (activeNoteRef.current === targetNote && noteContentRef.current === content) {
          setNoteDirty(false);
          noteDirtyRef.current = false;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSaveError(message);
        throw error;
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  // Load note content when activeNote changes
  useEffect(() => {
    let cancelled = false;
    const previousNote = activeNoteRef.current;
    const previousContent = noteContentRef.current;
    const previousDirty = noteDirtyRef.current;
    activeNoteRef.current = activeNote;

    const run = async () => {
      if (previousNote && previousDirty && previousNote !== activeNote) {
        try {
          const trimmed = previousContent.trim();
          if (!trimmed) {
            await deleteItems([previousNote]);
            emitTreeInvalidated();
          } else {
            await saveNow(previousNote, previousContent);
            const renameTarget = getAutoRenameTarget(
              previousNote,
              previousContent,
              noteFileNameFormat
            );
            if (renameTarget) {
              await renameItem(previousNote, renameTarget);
              emitTreeInvalidated();
            }
          }
        } catch (error) {
          console.error("[notes] failed to flush previous note", error);
        }
      }

      if (!activeNote) {
        if (!cancelled) {
          setNoteDirty(false);
        }
        return;
      }

      const content = await readNote(activeNote);
      if (!cancelled) {
        setNoteContent(content);
        setNoteDirty(false);
        setSaveError(null);
        noteContentRef.current = content;
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [activeNote, noteFileNameFormat, saveNow]);

  // Autosave with debounce
  useEffect(() => {
    if (!activeNote || !noteDirty) {
      return;
    }
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }
    saveTimer.current = window.setTimeout(() => {
      void saveNow(activeNote, noteContent);
    }, 400);
    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }
    };
  }, [activeNote, noteContent, noteDirty, saveNow]);

  const handleEditorChange = (markdown: string) => {
    if (!activeNote) {
      setDraftNoteContent((prev) => (prev === markdown ? prev : markdown));
      return;
    }
    setNoteContent((prev) => (prev === markdown ? prev : markdown));
    noteContentRef.current = markdown;
    setNoteDirty(true);
    noteDirtyRef.current = true;
    setSaveError(null);
  };

  const clearNote = useCallback(() => {
    setNoteContent("");
    setNoteDirty(false);
    noteDirtyRef.current = false;
  }, []);

  const clearDraft = useCallback(() => {
    setDraftNoteContent("");
  }, []);

  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!activeNoteRef.current || !noteDirtyRef.current) {
      return;
    }
    await saveNow(activeNoteRef.current, noteContentRef.current);
  }, [saveNow]);

  const retrySave = useCallback(async () => {
    if (!activeNoteRef.current) {
      return;
    }
    await saveNow(activeNoteRef.current, noteContentRef.current);
  }, [saveNow]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }
    };
  }, []);

  const isSaved = !noteDirty && !isSaving && !saveError;

  return {
    noteContent,
    draftNoteContent,
    noteDirty,
    isSaving,
    saveError,
    isSaved,
    handleEditorChange,
    clearNote,
    clearDraft,
    flushSave,
    retrySave,
  };
}
