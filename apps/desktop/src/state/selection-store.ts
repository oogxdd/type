// Selection domain store: which folders/notes are selected and active.
// Like every other domain: raw state in zustand, actions as plain module
// functions callable from components, stores, and workflows alike.
import { create } from "zustand";

import { getNoteParentPath } from "@typenotes/shared/notes";

type SetValue<T> = T | ((current: T) => T);

export type SelectionState = {
  selectedFolders: Set<string>;
  lastSelectedFolder: string;
  activeFolder: string;
  selectedNotes: Set<string>;
  lastSelectedNote: string;
  activeNote: string | null;
};

const emptySelection = (): SelectionState => ({
  selectedFolders: new Set<string>(),
  lastSelectedFolder: "",
  activeFolder: "",
  selectedNotes: new Set<string>(),
  lastSelectedNote: "",
  activeNote: null,
});

const resolveValue = <T,>(value: SetValue<T>, current: T): T =>
  typeof value === "function" ? (value as (current: T) => T)(current) : value;

export const useSelection = create<SelectionState>(emptySelection);

export const setSelectedFolders = (value: SetValue<Set<string>>) =>
  useSelection.setState((state) => ({
    selectedFolders: resolveValue(value, state.selectedFolders),
  }));
export const setLastSelectedFolder = (lastSelectedFolder: string) =>
  useSelection.setState({ lastSelectedFolder });
export const setActiveFolder = (activeFolder: string) =>
  useSelection.setState({ activeFolder });
export const setSelectedNotes = (value: SetValue<Set<string>>) =>
  useSelection.setState((state) => ({
    selectedNotes: resolveValue(value, state.selectedNotes),
  }));
export const setLastSelectedNote = (lastSelectedNote: string) =>
  useSelection.setState({ lastSelectedNote });
export const setActiveNote = (activeNote: string | null) =>
  useSelection.setState({ activeNote });

/**
 * Make one folder the active selection and drop any note selection.
 * `selectedFolders` overrides the single-folder set for range clicks.
 */
export const selectFolder = (path: string, selectedFolders?: Set<string>) =>
  useSelection.setState({
    selectedFolders: selectedFolders ?? new Set(path ? [path] : []),
    lastSelectedFolder: path,
    activeFolder: path,
    selectedNotes: new Set(),
    lastSelectedNote: "",
    activeNote: null,
  });

/**
 * Make one note (inside its given or derived parent folder) the active
 * selection. `selectedNotes` overrides the single-note set for range clicks.
 */
export const selectNote = (
  notePath: string,
  parentPath?: string,
  selectedNotes?: Set<string>
) => {
  const parent = parentPath ?? getNoteParentPath(notePath);
  useSelection.setState({
    selectedFolders: new Set(parent ? [parent] : []),
    lastSelectedFolder: parent,
    activeFolder: parent,
    selectedNotes: selectedNotes ?? new Set([notePath]),
    lastSelectedNote: notePath,
    activeNote: notePath,
  });
};

export const resetSelection = () => useSelection.setState(emptySelection());
