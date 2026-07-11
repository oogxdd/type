// Note-preview loader: stale-while-revalidate over one batched IPC call.
// A module-level cache keyed by path keeps object identity for unchanged
// previews (memoized rows don't re-render); a per-profile localStorage
// snapshot makes the first paint instant. Plaintext preview snapshots must
// never persist for encrypted vaults — currentPersistKey() enforces that.
import {
  formatNoteDateLabel,
  parseNotePreview,
  type NotePreview,
} from "@typenotes/shared/format";
import type { NoteEntry } from "@typenotes/shared/types";
import { listNotePreviews } from "@/api/notes-api";
import {
  selectActiveProfileId,
  useProfilesStore,
} from "./profiles-store";
import {
  selectIsSecurityEnabled,
  useSecurityStore,
} from "./security-store";
import { NOTE_PREVIEW_CACHE_PREFIX } from "@/lib/storage";
import {
  computePreviewSourceNotes,
  selectAllNotes,
  useNotesStore,
} from "./notes-store";

type CachedPreview = { updatedMs: number | null; preview: NotePreview };

let cache = new Map<string, CachedPreview>();
// Identity of the last-fetched source set; a repeat call with the same set is
// a no-op so refresh can be triggered liberally from subscriptions.
let lastFetchedNotes: NoteEntry[] | null = null;
let fetchSequence = 0;

const currentPersistKey = (): string | null => {
  const profileId = selectActiveProfileId(useProfilesStore.getState());
  const securityEnabled = selectIsSecurityEnabled(useSecurityStore.getState());
  return !securityEnabled && profileId ? profileId : null;
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

/**
 * Profile/root switches replace the cache wholesale with that profile's
 * persisted snapshot, so the first paint after launch is instant and stale
 * entries from another profile can never leak in.
 */
export function resetPreviewCacheForActiveProfile() {
  const persistKey = currentPersistKey();
  cache = persistKey ? readPersistedPreviews(persistKey) : new Map();
  lastFetchedNotes = null;
  void refreshNotePreviews();
}

/** Drop cached parses and refetch — call after anything that edits note files. */
export function invalidateNotePreviews() {
  cache.clear();
  lastFetchedNotes = null;
  void refreshNotePreviews();
}

export async function refreshNotePreviews() {
  const notes = computePreviewSourceNotes();
  if (notes === lastFetchedNotes) {
    return;
  }
  lastFetchedNotes = notes;

  if (notes.length === 0) {
    useNotesStore.setState({ previews: {}, previewsLoading: false });
    return;
  }

  fetchSequence += 1;
  const sequence = fetchSequence;

  // Paint whatever is already cached while the fresh batch loads.
  const cachedPreviews: Record<string, NotePreview> = {};
  notes.forEach((note) => {
    const cached = cache.get(note.path);
    if (cached) {
      cachedPreviews[note.path] = cached.preview;
    }
  });
  useNotesStore.setState({ previews: cachedPreviews, previewsLoading: true });

  try {
    // One IPC round trip for the whole list; the backend reads each file
    // once and returns body + meta together.
    const entries = await listNotePreviews(notes.map((note) => note.path));
    if (sequence !== fetchSequence) {
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
    useNotesStore.setState({ previews: next });

    const persistKey = currentPersistKey();
    if (persistKey) {
      const livePaths = new Set(
        selectAllNotes(useNotesStore.getState()).map((note) => note.path)
      );
      writePersistedPreviews(persistKey, livePaths);
    }
  } catch (error) {
    console.error("[notes] failed to load note previews", error);
  } finally {
    if (sequence === fetchSequence) {
      useNotesStore.setState({ previewsLoading: false });
    }
  }
}
