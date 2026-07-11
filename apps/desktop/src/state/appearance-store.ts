import { create } from "zustand";

import { applyThemeToDocument } from "@/app/launch-screen";
import {
  DEFAULT_EDITOR_FONT_SIZE,
  MAX_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
} from "@/lib/constants";
import {
  getInitialEditorFontSize,
  getInitialHideArchivedFeedNotes,
  getInitialNotesListMode,
  getInitialTheme,
} from "@/lib/storage";
import type { NotesListMode, ThemeMode } from "@typenotes/shared/types";

type AppearanceState = {
  theme: ThemeMode;
  notesListMode: NotesListMode;
  hideArchivedFeedNotes: boolean;
  editorFontSize: number;
  setTheme: (theme: ThemeMode) => void;
  setNotesListMode: (mode: NotesListMode) => void;
  setHideArchivedFeedNotes: (hidden: boolean) => void;
  setEditorFontSize: (size: number) => void;
  increaseEditorFontSize: () => void;
  decreaseEditorFontSize: () => void;
  resetEditorFontSize: () => void;
};

export const useAppearance = create<AppearanceState>((set) => ({
  theme: getInitialTheme(),
  notesListMode: getInitialNotesListMode(),
  hideArchivedFeedNotes: getInitialHideArchivedFeedNotes(),
  editorFontSize: getInitialEditorFontSize(),
  setTheme: (theme) => set({ theme }),
  setNotesListMode: (notesListMode) => set({ notesListMode }),
  setHideArchivedFeedNotes: (hideArchivedFeedNotes) => set({ hideArchivedFeedNotes }),
  setEditorFontSize: (editorFontSize) =>
    set({
      editorFontSize: Math.min(
        MAX_EDITOR_FONT_SIZE,
        Math.max(MIN_EDITOR_FONT_SIZE, editorFontSize)
      ),
    }),
  increaseEditorFontSize: () =>
    set((state) => ({
      editorFontSize: Math.min(MAX_EDITOR_FONT_SIZE, state.editorFontSize + 1),
    })),
  decreaseEditorFontSize: () =>
    set((state) => ({
      editorFontSize: Math.max(MIN_EDITOR_FONT_SIZE, state.editorFontSize - 1),
    })),
  resetEditorFontSize: () => set({ editorFontSize: DEFAULT_EDITOR_FONT_SIZE }),
}));

/** Persist appearance changes and keep the document theme in sync. Call once at boot. */
export function initAppearancePersistence() {
  const persist = (state: AppearanceState, previous?: AppearanceState) => {
    if (!previous || state.theme !== previous.theme) {
      window.localStorage.setItem("notes-viewer-theme", state.theme);
      applyThemeToDocument(state.theme);
    }
    if (!previous || state.notesListMode !== previous.notesListMode) {
      window.localStorage.setItem(
        "notes-viewer-notes-list-mode",
        state.notesListMode
      );
    }
    if (!previous || state.hideArchivedFeedNotes !== previous.hideArchivedFeedNotes) {
      window.localStorage.setItem(
        "notes-viewer-hide-archived-feed-notes",
        String(state.hideArchivedFeedNotes)
      );
    }
    if (!previous || state.editorFontSize !== previous.editorFontSize) {
      window.localStorage.setItem(
        "notes-viewer-editor-font-size",
        String(state.editorFontSize)
      );
    }
  };

  persist(useAppearance.getState());
  useAppearance.subscribe(persist);
}
