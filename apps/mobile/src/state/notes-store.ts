import { create } from "zustand";

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import type { NotePreview } from "@typenotes/shared/format";
import type { FolderNode } from "@typenotes/shared/types";

import { collectNotePaths, previewsByPath } from "../lib/feed";

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
};

export const useNotesStore = create<NotesState>((set, get) => ({
  tree: null,
  previews: new Map(),
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true });
    try {
      const tree = await core.getTree();
      const entries = await core.listNotePreviews(collectNotePaths(tree));
      set({ tree, previews: previewsByPath(entries), loading: false, error: null });
    } catch (error) {
      set({ loading: false, error: getErrorMessage(error) });
    }
  },

  refreshPreviews: async (paths) => {
    if (paths.length === 0) {
      return;
    }
    try {
      const entries = await core.listNotePreviews(paths);
      const previews = new Map(get().previews);
      for (const [path, preview] of previewsByPath(entries)) {
        previews.set(path, preview);
      }
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
}));
