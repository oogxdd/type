import { useEffect, useRef, useState } from "react";
import { getNoteMeta, readNote } from "@/data/notesApi";
import { parseNotePreview, type NotePreview } from "@/utils/format";
import type { NoteEntry } from "@/types";

// Cap how many notes we read at once so a large vault can't flood the Tauri IPC
// bridge (and the main thread) in a single burst.
const PREVIEW_FETCH_CONCURRENCY = 6;

type CachedPreview = { updatedMs: number | null; preview: NotePreview };

export function useNotePreviews(notes: NoteEntry[]) {
  const [notePreviews, setNotePreviews] = useState<Record<string, NotePreview>>({});
  const [refreshToken, setRefreshToken] = useState(0);
  // Persist resolved previews across refreshes so re-reading the tree doesn't
  // re-read every note's full content from disk again.
  const cacheRef = useRef<Map<string, CachedPreview>>(new Map());

  useEffect(() => {
    const onInvalidated = () => {
      cacheRef.current.clear();
      setRefreshToken((value) => value + 1);
    };
    window.addEventListener("note-previews-invalidated", onInvalidated);
    return () => window.removeEventListener("note-previews-invalidated", onInvalidated);
  }, []);

  useEffect(() => {
    if (notes.length === 0) {
      cacheRef.current.clear();
      setNotePreviews({});
      return;
    }
    let cancelled = false;
    const cache = cacheRef.current;

    const run = async () => {
      // Forget notes that no longer exist.
      const livePaths = new Set(notes.map((note) => note.path));
      for (const path of [...cache.keys()]) {
        if (!livePaths.has(path)) {
          cache.delete(path);
        }
      }

      // Pull only the content we actually need: a cheap meta (stat) tells us
      // whether the cached preview is still current; we read the full note body
      // only for new or modified notes.
      const queue = [...notes];
      const fetchNext = async (): Promise<void> => {
        const note = queue.shift();
        if (!note || cancelled) {
          return;
        }
        try {
          const meta = await getNoteMeta(note.path);
          const updatedMs = meta.updated_ms ?? meta.created_ms ?? null;
          const cached = cache.get(note.path);
          if (!cached || cached.updatedMs !== updatedMs) {
            const content = await readNote(note.path);
            cache.set(note.path, {
              updatedMs,
              preview: parseNotePreview(content, updatedMs, meta),
            });
          }
        } catch (error) {
          console.error("[notes] failed to build preview", note.path, error);
        }
        await fetchNext();
      };

      const workers = Array.from(
        { length: Math.min(PREVIEW_FETCH_CONCURRENCY, queue.length) },
        () => fetchNext()
      );
      await Promise.all(workers);

      if (cancelled) {
        return;
      }
      const next: Record<string, NotePreview> = {};
      notes.forEach((note) => {
        const cached = cache.get(note.path);
        if (cached) {
          next[note.path] = cached.preview;
        }
      });
      setNotePreviews(next);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [notes, refreshToken]);

  return notePreviews;
}
