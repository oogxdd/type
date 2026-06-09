import { useEffect, useRef, useState } from "react";
import { listNotePreviews } from "../../api/notes-api";
import { parseNotePreview, type NotePreview } from "@/shared/lib/format";
import type { NoteEntry } from "@/shared/types";

type CachedPreview = { updatedMs: number | null; preview: NotePreview };

export function useNotePreviews(notes: NoteEntry[]) {
  const [notePreviews, setNotePreviews] = useState<Record<string, NotePreview>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  // Persist resolved previews across refreshes so re-reading the tree doesn't
  // re-parse every note and unchanged rows keep their preview object identity.
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
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    const cache = cacheRef.current;

    const run = async () => {
      setIsLoading(true);
      // Forget notes that no longer exist.
      const livePaths = new Set(notes.map((note) => note.path));
      for (const path of [...cache.keys()]) {
        if (!livePaths.has(path)) {
          cache.delete(path);
        }
      }
      // Show whatever is already cached while the fresh batch loads.
      const cachedPreviews: Record<string, NotePreview> = {};
      notes.forEach((note) => {
        const cached = cache.get(note.path);
        if (cached) {
          cachedPreviews[note.path] = cached.preview;
        }
      });
      setNotePreviews(cachedPreviews);

      try {
        // One IPC round trip for the whole list; the backend reads each file
        // once and returns body + meta together.
        const entries = await listNotePreviews(notes.map((note) => note.path));
        if (cancelled) {
          return;
        }
        const next: Record<string, NotePreview> = {};
        for (const entry of entries) {
          const updatedMs = entry.meta.updated_ms ?? entry.meta.created_ms ?? null;
          const cached = cache.get(entry.path);
          const preview =
            cached && cached.updatedMs === updatedMs
              ? cached.preview
              : parseNotePreview(entry.content, updatedMs, entry.meta);
          cache.set(entry.path, { updatedMs, preview });
          next[entry.path] = preview;
        }
        setNotePreviews(next);
      } catch (error) {
        console.error("[notes] failed to load note previews", error);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [notes, refreshToken]);

  return { previews: notePreviews, isLoading };
}
