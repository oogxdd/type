import { useEffect, type ReactNode } from "react";
import { create } from "zustand";

import { applyThemeToDocument } from "@/app/launch-screen";
import {
  DEFAULT_EDITOR_FONT_SIZE,
  MAX_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
} from "@/shared/constants";
import {
  getInitialEditorFontSize,
  getInitialHideArchivedFeedNotes,
  getInitialNotesListMode,
  getInitialShowVimModeIndicator,
  getInitialTheme,
} from "@/shared/lib/storage";
import type { NotesListMode, ThemeMode } from "@typenotes/shared/types";

export type DesignFontId = "helvetica" | "system" | "avenir" | "serif" | "mono";
export type DesignColorId = "background" | "text" | "muted" | "border" | "selection";

export type DesignPalette = Record<DesignColorId, string>;

export const DESIGN_FONT_OPTIONS: Array<{
  id: DesignFontId;
  label: string;
  family: string;
}> = [
  {
    id: "helvetica",
    label: "Helvetica Neue",
    family: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  },
  {
    id: "system",
    label: "System Sans",
    family: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  {
    id: "avenir",
    label: "Avenir Next",
    family: '"Avenir Next", Avenir, sans-serif',
  },
  {
    id: "serif",
    label: "Iowan Old Style",
    family: '"Iowan Old Style", "Palatino Linotype", Georgia, serif',
  },
  {
    id: "mono",
    label: "SF Mono",
    family: '"SF Mono", Menlo, Monaco, monospace',
  },
];

export const DEFAULT_DESIGN_PALETTES: Record<ThemeMode, DesignPalette> = {
  light: {
    background: "#fafafa",
    text: "#292421",
    muted: "#77716e",
    border: "#e2e0df",
    selection: "#eceae9",
  },
  dark: {
    background: "#0b0a09",
    text: "#c9c6c3",
    muted: "#888583",
    border: "#252321",
    selection: "#201f1e",
  },
};

const DESIGN_SETTINGS_STORAGE_KEY = "notes-viewer-design-settings";
const DEFAULT_DESIGN_FONT: DesignFontId = "helvetica";
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const cloneDefaultPalettes = (): Record<ThemeMode, DesignPalette> => ({
  light: { ...DEFAULT_DESIGN_PALETTES.light },
  dark: { ...DEFAULT_DESIGN_PALETTES.dark },
});

const getInitialDesignSettings = () => {
  const fallback = {
    designFont: DEFAULT_DESIGN_FONT,
    designPalettes: cloneDefaultPalettes(),
  };
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const stored = JSON.parse(
      window.localStorage.getItem(DESIGN_SETTINGS_STORAGE_KEY) ?? "null"
    ) as {
      designFont?: unknown;
      designPalettes?: Partial<Record<ThemeMode, Partial<DesignPalette>>>;
    } | null;
    const designFont = DESIGN_FONT_OPTIONS.some((option) => option.id === stored?.designFont)
      ? (stored?.designFont as DesignFontId)
      : DEFAULT_DESIGN_FONT;
    const designPalettes = cloneDefaultPalettes();

    for (const theme of ["light", "dark"] as const) {
      for (const color of Object.keys(designPalettes[theme]) as DesignColorId[]) {
        const value = stored?.designPalettes?.[theme]?.[color];
        if (typeof value === "string" && HEX_COLOR_PATTERN.test(value)) {
          designPalettes[theme][color] = value;
        }
      }
    }

    return { designFont, designPalettes };
  } catch {
    return fallback;
  }
};

const initialDesignSettings = getInitialDesignSettings();

type AppearanceState = {
  theme: ThemeMode;
  notesListMode: NotesListMode;
  hideArchivedFeedNotes: boolean;
  editorFontSize: number;
  showVimModeIndicator: boolean;
  designFont: DesignFontId;
  designPalettes: Record<ThemeMode, DesignPalette>;
  setTheme: (theme: ThemeMode) => void;
  setNotesListMode: (mode: NotesListMode) => void;
  setHideArchivedFeedNotes: (hidden: boolean) => void;
  setEditorFontSize: (size: number) => void;
  setShowVimModeIndicator: (visible: boolean) => void;
  increaseEditorFontSize: () => void;
  decreaseEditorFontSize: () => void;
  resetEditorFontSize: () => void;
  setDesignFont: (font: DesignFontId) => void;
  setDesignColor: (theme: ThemeMode, color: DesignColorId, value: string) => void;
  resetDesignPalette: (theme: ThemeMode) => void;
};

export const useAppearance = create<AppearanceState>((set) => ({
  theme: getInitialTheme(),
  notesListMode: getInitialNotesListMode(),
  hideArchivedFeedNotes: getInitialHideArchivedFeedNotes(),
  editorFontSize: getInitialEditorFontSize(),
  showVimModeIndicator: getInitialShowVimModeIndicator(),
  designFont: initialDesignSettings.designFont,
  designPalettes: initialDesignSettings.designPalettes,
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
  setShowVimModeIndicator: (showVimModeIndicator) =>
    set({ showVimModeIndicator }),
  increaseEditorFontSize: () =>
    set((state) => ({
      editorFontSize: Math.min(MAX_EDITOR_FONT_SIZE, state.editorFontSize + 1),
    })),
  decreaseEditorFontSize: () =>
    set((state) => ({
      editorFontSize: Math.max(MIN_EDITOR_FONT_SIZE, state.editorFontSize - 1),
    })),
  resetEditorFontSize: () => set({ editorFontSize: DEFAULT_EDITOR_FONT_SIZE }),
  setDesignFont: (designFont) => set({ designFont }),
  setDesignColor: (theme, color, value) => {
    if (!HEX_COLOR_PATTERN.test(value)) {
      return;
    }
    set((state) => ({
      designPalettes: {
        ...state.designPalettes,
        [theme]: {
          ...state.designPalettes[theme],
          [color]: value.toLowerCase(),
        },
      },
    }));
  },
  resetDesignPalette: (theme) =>
    set((state) => ({
      designPalettes: {
        ...state.designPalettes,
        [theme]: { ...DEFAULT_DESIGN_PALETTES[theme] },
      },
    })),
}));

export function AppearanceProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
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
      if (
        !previous ||
        state.showVimModeIndicator !== previous.showVimModeIndicator
      ) {
        window.localStorage.setItem(
          "notes-viewer-show-vim-mode-indicator",
          String(state.showVimModeIndicator)
        );
      }
      if (
        !previous ||
        state.designFont !== previous.designFont ||
        state.designPalettes !== previous.designPalettes
      ) {
        window.localStorage.setItem(
          DESIGN_SETTINGS_STORAGE_KEY,
          JSON.stringify({
            designFont: state.designFont,
            designPalettes: state.designPalettes,
          })
        );
      }
    };

    persist(useAppearance.getState());
    return useAppearance.subscribe(persist);
  }, []);

  return children;
}
