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
}));
