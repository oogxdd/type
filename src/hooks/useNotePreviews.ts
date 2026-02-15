import { useEffect, useState } from "react";
import { getNoteMeta, readNote } from "../data/notesApi";
import {
  extractCreatedAtFromFrontMatter,
  parseNotePreview,
  type NotePreview,
} from "../utils/format";
import type { NoteEntry } from "../types";

export function useNotePreviews(notes: NoteEntry[]) {
  const [notePreviews, setNotePreviews] = useState<Record<string, NotePreview>>({});

  useEffect(() => {
    if (notes.length === 0) {
      setNotePreviews({});
      return;
    }
    let cancelled = false;
    Promise.all(
      notes.map(async (note) => {
        const [meta, content] = await Promise.all([
          getNoteMeta(note.path),
          readNote(note.path),
        ]);
        const updatedMs = meta.updated_ms ?? meta.created_ms ?? null;
        const createdAtMs =
          extractCreatedAtFromFrontMatter(content) ?? meta.created_ms ?? meta.updated_ms ?? null;
        return [
          note.path,
          parseNotePreview(note.name, content, updatedMs, createdAtMs),
        ] as const;
      })
    )
      .then((entries) => {
        if (cancelled) {
          return;
        }
        setNotePreviews(Object.fromEntries(entries));
      })
      .catch((error) => {
        console.error("[notes] failed to build previews", error);
      });
    return () => {
      cancelled = true;
    };
  }, [notes]);

  return notePreviews;
}
