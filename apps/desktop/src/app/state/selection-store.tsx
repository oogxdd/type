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
  resetSelection: () => void;
  selectFolderForMobile: (path: string) => void;
  selectNoteForMobile: (notePath: string) => void;
  enterMobileHome: () => void;
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
  resetSelection: () =>
    set({
      ...emptySelection,
      selectedFolders: new Set(),
      selectedNotes: new Set(),
    }),
  selectFolderForMobile: (path) => {
    if (!path) return;
    set({
      selectedFolders: new Set([path]),
      lastSelectedFolder: path,
      activeFolder: path,
      selectedNotes: new Set(),
      lastSelectedNote: "",
      activeNote: null,
    });
  },
  selectNoteForMobile: (notePath) => {
    const parentPath = getNoteParentPath(notePath);
    set({
      selectedFolders: new Set(parentPath ? [parentPath] : []),
      lastSelectedFolder: parentPath,
      activeFolder: parentPath,
      selectedNotes: new Set([notePath]),
      lastSelectedNote: notePath,
      activeNote: notePath,
    });
  },
  enterMobileHome: () =>
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
