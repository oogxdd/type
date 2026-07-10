import { useEffect, type ReactNode } from "react";
import { create } from "zustand";

import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import { getNoteParentPath } from "@typenotes/shared/notes";

type SetValue<T> = T | ((current: T) => T);

export type SelectionState = {
  selectedFolders: Set<string>;
  lastSelectedFolder: string;
  activeFolder: string;
  selectedNotes: Set<string>;
  lastSelectedNote: string;
  activeNote: string | null;
  setSelectedFolders: (value: SetValue<Set<string>>) => void;
  setLastSelectedFolder: (path: string) => void;
  setActiveFolder: (path: string) => void;
  setSelectedNotes: (value: SetValue<Set<string>>) => void;
  setLastSelectedNote: (path: string) => void;
  setActiveNote: (path: string | null) => void;
  /**
   * Make one folder the active selection and drop any note selection.
   * `selectedFolders` overrides the single-folder set for range clicks.
   */
  selectFolder: (path: string, selectedFolders?: Set<string>) => void;
  /**
   * Make one note (inside its given or derived parent folder) the active
   * selection. `selectedNotes` overrides the single-note set for range clicks.
   */
  selectNote: (
    notePath: string,
    parentPath?: string,
    selectedNotes?: Set<string>
  ) => void;
  resetSelection: () => void;
};

const emptySelection = {
  selectedFolders: new Set<string>(),
  lastSelectedFolder: "",
  activeFolder: "",
  selectedNotes: new Set<string>(),
  lastSelectedNote: "",
  activeNote: null,
};

const resolveValue = <T,>(value: SetValue<T>, current: T): T =>
  typeof value === "function" ? (value as (current: T) => T)(current) : value;

const useSelectionStore = create<SelectionState>((set) => ({
  ...emptySelection,
  setSelectedFolders: (value) =>
    set((state) => ({ selectedFolders: resolveValue(value, state.selectedFolders) })),
  setLastSelectedFolder: (lastSelectedFolder) => set({ lastSelectedFolder }),
  setActiveFolder: (activeFolder) => set({ activeFolder }),
  setSelectedNotes: (value) =>
    set((state) => ({ selectedNotes: resolveValue(value, state.selectedNotes) })),
  setLastSelectedNote: (lastSelectedNote) => set({ lastSelectedNote }),
  setActiveNote: (activeNote) => set({ activeNote }),
  selectFolder: (path, selectedFolders) =>
    set({
      selectedFolders: selectedFolders ?? new Set(path ? [path] : []),
      lastSelectedFolder: path,
      activeFolder: path,
      selectedNotes: new Set(),
      lastSelectedNote: "",
      activeNote: null,
    }),
  selectNote: (notePath, parentPath, selectedNotes) => {
    const parent = parentPath ?? getNoteParentPath(notePath);
    set({
      selectedFolders: new Set(parent ? [parent] : []),
      lastSelectedFolder: parent,
      activeFolder: parent,
      selectedNotes: selectedNotes ?? new Set([notePath]),
      lastSelectedNote: notePath,
      activeNote: notePath,
    });
  },
  resetSelection: () =>
    set({
      ...emptySelection,
      selectedFolders: new Set(),
      selectedNotes: new Set(),
    }),
}));

export function SelectionProvider({ children }: { children: ReactNode }) {
  const { activeProfileId, activeProfileNotesRoot } = useProfiles();
  const resetSelection = useSelectionStore((state) => state.resetSelection);

  // Selection belongs to a profile root and must never leak across a switch.
  useEffect(() => {
    if (activeProfileId) {
      resetSelection();
    }
  }, [activeProfileId, activeProfileNotesRoot, resetSelection]);

  return children;
}

export const useSelection = useSelectionStore;
