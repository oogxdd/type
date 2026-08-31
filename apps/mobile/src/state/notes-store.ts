import { create } from "zustand";

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import type { NotePreview } from "@typenotes/shared/format";
import type { FolderNode } from "@typenotes/shared/types";

import { collectNotePaths, previewsByPath } from "../lib/feed";
// notes-store and sync-store reference each other, but only from inside action
// bodies (`getState()` at call time), never while either module is evaluating.
import { useSyncStore } from "./sync-store";

/**
 * How many notes one `list_note_previews` call may cover.
 *
 * That command returns the decrypted body of every path it is given as a
 * single JSON string: asking for a whole notes root builds that string in
 * Rust, ships it across the FFI bridge and parses it again in JS — one very
 * large allocation, on a phone, while the UI is live. Batching keeps the peak
 * bounded no matter how many notes the folder holds.
 */
const PREVIEW_BATCH = 200;

const collectPreviewsInto = async (
  paths: string[],
  into: Map<string, NotePreview>
): Promise<void> => {
  for (let index = 0; index < paths.length; index += PREVIEW_BATCH) {
    const entries = await core.listNotePreviews(
      paths.slice(index, index + PREVIEW_BATCH)
    );
    for (const [path, preview] of previewsByPath(entries)) {
      into.set(path, preview);
    }
  }
};

type NotesState = {
  tree: FolderNode | null;
  previews: Map<string, NotePreview>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Refresh previews for a few paths without re-reading the whole tree. */
  refreshPreviews: (paths: string[]) => Promise<void>;
  /**
   * A single note appeared (capture filed a page): reload the body-free tree
   * and only that note's preview.
   *
   * Deliberately *not* `refresh()`. `list_note_previews` returns the decrypted
   * body of every path it is given, so a full refresh ships the entire corpus
   * across the FFI bridge as one JSON string and parses it again in JS. Doing
   * that on every swipe-up made the cost of filing a page grow with the size
   * of the notes folder — on a phone that is a large, repeated allocation on
   * the JS thread while a spring animation and the keyboard are both live.
   */
  noteFiled: (path: string) => Promise<void>;

  // ── Mutations ──
  // Each one calls the core, reloads only what changed, and schedules a sync.
  // None of them calls `refresh()`: re-reading every note body after moving a
  // single note is the cost this store exists to avoid.

  /** Move notes (or folders) into `destination`, creating it if missing. */
  moveNotes: (paths: string[], destination: string) => Promise<void>;
  deleteNotes: (paths: string[]) => Promise<void>;
  /** Set the front-matter `archived_ms` marker; the note does not move. */
  setArchived: (path: string, archived: boolean) => Promise<void>;
};

export const useNotesStore = create<NotesState>((set, get) => {
  /**
   * Reload the tree after a mutation and fetch previews only for paths that
   * are genuinely new — the notes that moved keep their content, only their
   * key changes. Previews for paths that no longer exist are dropped.
   *
   * Diffing against the tree rather than assuming `destination/basename`
   * survives the core renaming a file to avoid a collision.
   */
  const settleAfterMutation = async (removedPaths: string[]): Promise<void> => {
    const before = new Set(collectNotePaths(get().tree));
    const tree = await core.getTree();
    const paths = collectNotePaths(tree);
    const previews = new Map(get().previews);
    for (const path of removedPaths) {
      previews.delete(path);
    }
    const live = new Set(paths);
    for (const path of [...previews.keys()]) {
      if (!live.has(path)) {
        previews.delete(path);
      }
    }
    await collectPreviewsInto(
      paths.filter((path) => !before.has(path) || !previews.has(path)),
      previews
    );
    set({ tree, previews, error: null });
  };

  /** Mutations report failure by throwing; the UI decides what to say. */
  const mutate = async (
    reason: string,
    run: () => Promise<void>
  ): Promise<void> => {
    try {
      await run();
    } catch (error) {
      set({ error: getErrorMessage(error) });
      throw error;
    }
    useSyncStore.getState().scheduleAutoSync(reason);
  };

  return {
  tree: null,
  previews: new Map(),
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true });
    try {
      const tree = await core.getTree();
      const previews = new Map<string, NotePreview>();
      await collectPreviewsInto(collectNotePaths(tree), previews);
      set({ tree, previews, loading: false, error: null });
    } catch (error) {
      set({ loading: false, error: getErrorMessage(error) });
    }
  },

  refreshPreviews: async (paths) => {
    if (paths.length === 0) {
      return;
    }
    try {
      const previews = new Map(get().previews);
      await collectPreviewsInto(paths, previews);
      set({ previews });
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  noteFiled: async (path) => {
    try {
      // get_tree never reads note bodies, so this stays cheap no matter how
      // many notes the folder holds.
      const tree = await core.getTree();
      set({ tree, error: null });
    } catch (error) {
      set({ error: getErrorMessage(error) });
      return;
    }
    await get().refreshPreviews([path]);
  },

  moveNotes: async (paths, destination) => {
    if (paths.length === 0) {
      return;
    }
    await mutate("notes moved", async () => {
      // The core create_dir_all's the destination, so this is also how a new
      // folder comes into existence — there is no create-folder command.
      await core.moveItems(paths, destination);
      await settleAfterMutation(paths);
    });
  },

  deleteNotes: async (paths) => {
    if (paths.length === 0) {
      return;
    }
    await mutate("notes deleted", async () => {
      await core.deleteItems(paths);
      await settleAfterMutation(paths);
    });
  },

  setArchived: async (path, archived) => {
    await mutate(archived ? "note archived" : "note unarchived", async () => {
      await core.updateNoteMarkers({ path, archived });
      // The body is unchanged; only the marker in its front matter moved.
      await get().refreshPreviews([path]);
    });
  },
  };
});
