import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ThemeMode, NotesListMode } from "@/types";
import {
  DEFAULT_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
  MAX_EDITOR_FONT_SIZE,
} from "../constants";
import { setNativeTheme } from "../data/appearance-api";
import { applyThemeToDocument } from "@/app/launch-screen";
import { getInitialTheme, getInitialNotesListMode, getInitialEditorFontSize } from "../utils/storage";

type ThemeContextValue = {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  notesListMode: NotesListMode;
  setNotesListMode: (mode: NotesListMode) => void;
  editorFontSize: number;
  setEditorFontSize: (size: number) => void;
  increaseEditorFontSize: () => void;
  decreaseEditorFontSize: () => void;
  resetEditorFontSize: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [notesListMode, setNotesListMode] = useState<NotesListMode>(getInitialNotesListMode);
  const [editorFontSize, setEditorFontSize] = useState(getInitialEditorFontSize);

  useEffect(() => {
    window.localStorage.setItem("notes-viewer-theme", theme);
    applyThemeToDocument(theme);
    void setNativeTheme(theme).catch(() => {});
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("notes-viewer-notes-list-mode", notesListMode);
  }, [notesListMode]);

  useEffect(() => {
    window.localStorage.setItem(
      "notes-viewer-editor-font-size",
      String(editorFontSize)
    );
  }, [editorFontSize]);

  const increaseEditorFontSize = useCallback(() => {
    setEditorFontSize((prev) => Math.min(MAX_EDITOR_FONT_SIZE, prev + 1));
  }, []);

  const decreaseEditorFontSize = useCallback(() => {
    setEditorFontSize((prev) => Math.max(MIN_EDITOR_FONT_SIZE, prev - 1));
  }, []);

  const resetEditorFontSize = useCallback(() => {
    setEditorFontSize(DEFAULT_EDITOR_FONT_SIZE);
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        notesListMode,
        setNotesListMode,
        editorFontSize,
        setEditorFontSize,
        increaseEditorFontSize,
        decreaseEditorFontSize,
        resetEditorFontSize,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
