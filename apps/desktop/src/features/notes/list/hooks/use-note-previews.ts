import { useEffect, useRef, useState } from "react";
import { listNotePreviews } from "../../api/notes-api";
import {
  formatNoteDateLabel,
  parseNotePreview,
  type NotePreview,
} from "@typenotes/shared/format";
import { NOTE_PREVIEW_CACHE_PREFIX } from "@/shared/lib/storage";
import type { NoteEntry } from "@typenotes/shared/types";

type CachedPreview = { updatedMs: number | null; preview: NotePreview };

type UseNotePreviewsOptions = {
  // Cache reset boundary — changes when the active profile/root changes.
  resetKey: string | null;
  // localStorage key suffix, or null to disable persistence (encryption on,
  // or no profile resolved yet). Plaintext previews must never persist for
  // encrypted vaults.
  persistKey: string | null;
  // Every note path in the vault, used to prune deleted notes from the
  // persisted snapshot at write time.
  allNotePaths: string[];
};

const readPersistedPreviews = (persistKey: string): Map<string, CachedPreview> => {
  const hydrated = new Map<string, CachedPreview>();
  try {
    const raw = window.localStorage.getItem(NOTE_PREVIEW_CACHE_PREFIX + persistKey);
    if (!raw) {
      return hydrated;
    }
    const parsed = JSON.parse(raw) as Record<string, CachedPreview>;
    for (const [path, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || !value.preview) {
        continue;
      }
      hydrated.set(path, {
        updatedMs: value.updatedMs ?? null,
        // Date labels are relative ("yesterday"); recompute for today.
        preview: {
          ...value.preview,
          dateLabel: formatNoteDateLabel(value.preview.updatedMs ?? null),
        },
      });
    }
  } catch {
    hydrated.clear();
  }
  return hydrated;
};

const writePersistedPreviews = (
  persistKey: string,
  cache: Map<string, CachedPreview>,
  livePaths: Set<string>
) => {
  try {
    const storageKey = NOTE_PREVIEW_CACHE_PREFIX + persistKey;
    // Merge over the existing snapshot: a refresh scoped to one folder must
    // not drop persisted previews of the rest of the vault.
    let merged: Record<string, CachedPreview> = {};
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        merged = JSON.parse(raw) as Record<string, CachedPreview>;
      }
    } catch {
      merged = {};
    }
    for (const path of Object.keys(merged)) {
      if (!livePaths.has(path)) {
        delete merged[path];
      }
    }
    for (const [path, value] of cache) {
      if (livePaths.has(path)) {
        merged[path] = value;
      }
    }
    window.localStorage.setItem(storageKey, JSON.stringify(merged));
  } catch {
    // Quota exceeded or storage unavailable — the cache is best-effort.
  }
};

export function useNotePreviews(
  notes: NoteEntry[],
  { resetKey, persistKey, allNotePaths }: UseNotePreviewsOptions
) {
  const [notePreviews, setNotePreviews] = useState<Record<string, NotePreview>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  // Previews accumulate here across refreshes and navigation so revisited
  // folders render instantly and unchanged rows keep object identity.
  const cacheRef = useRef<Map<string, CachedPreview>>(new Map());
  const persistKeyRef = useRef(persistKey);
  persistKeyRef.current = persistKey;
  const resetKeyRef = useRef(resetKey);
  resetKeyRef.current = resetKey;
  const allNotePathsRef = useRef(allNotePaths);
  allNotePathsRef.current = allNotePaths;

  useEffect(() => {
    const onInvalidated = (event: Event) => {
      const notePath = (event as CustomEvent<string>).detail;
      if (notePath) {
        const requestResetKey = resetKeyRef.current;
        // Autosaves only change one note. Refresh that row in the background
        // and retain every existing preview so Feed/tree navigation never
        // collapses into its loading state while the user is typing.
        void listNotePreviews([notePath])
          .then((entries) => {
            const entry = entries[0];
            if (
              !entry ||
              resetKeyRef.current !== requestResetKey ||
              !allNotePathsRef.current.includes(entry.path)
            ) {
              return;
            }
            const updatedMs = entry.meta.updated_ms ?? entry.meta.created_ms ?? null;
            const preview = parseNotePreview(entry.content, updatedMs, entry.meta);
            cacheRef.current.set(entry.path, { updatedMs, preview });
            setNotePreviews((current) => ({
              ...current,
              [entry.path]: preview,
            }));
            const currentPersistKey = persistKeyRef.current;
            if (currentPersistKey) {
              writePersistedPreviews(
                currentPersistKey,
                cacheRef.current,
                new Set(allNotePathsRef.current)
              );
            }
          })
          .catch((error) => {
            console.error("[notes] failed to refresh note preview", error);
          });
        return;
      }

      // Structural or bulk changes still request a full reconciliation, but
      // keep stale previews visible until the fresh batch arrives.
      setRefreshToken((value) => value + 1);
    };
    window.addEventListener("note-previews-invalidated", onInvalidated);
    return () => window.removeEventListener("note-previews-invalidated", onInvalidated);
  }, []);

  // Profile/root switches replace the cache wholesale with that profile's
  // persisted snapshot, so the first paint after launch is instant and stale
  // entries from another profile can never leak in.
  useEffect(() => {
    cacheRef.current = persistKey ? readPersistedPreviews(persistKey) : new Map();
    setRefreshToken((value) => value + 1);
  }, [persistKey, resetKey]);

  useEffect(() => {
    if (notes.length === 0) {
      setNotePreviews({});
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    const cache = cacheRef.current;

    const run = async () => {
      setIsLoading(true);
      // Paint whatever is already cached while the fresh batch loads.
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
        const currentPersistKey = persistKeyRef.current;
        if (currentPersistKey) {
          writePersistedPreviews(currentPersistKey, cache, new Set(allNotePathsRef.current));
        }
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
