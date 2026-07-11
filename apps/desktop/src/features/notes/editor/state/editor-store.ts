// Editor domain store: the active note's content, dirtiness, and the
// debounced-save machinery. Actions are plain module functions; the flush /
// load-on-selection-change workflow runs off store subscriptions, so no
// component needs to own editor lifecycle.
import { create } from "zustand";

import { useSelection } from "@/app/state/selection-store";
import {
  deleteItems,
  readNote,
  renameItem,
  writeNote,
} from "@/features/notes/api/notes-api";
import { getAutoRenameTarget } from "@/features/notes/editor/lib/note-autoname";
import { refreshTree } from "@/features/notes/navigation/state/notes-store";
import {
  registerProfileMutationFlush,
  selectActiveProfileId,
  selectActiveProfileNotesRoot,
  selectSyncSettings,
  useProfilesStore,
} from "@/features/profiles/state/profiles-store";
import { getErrorMessage } from "@typenotes/shared/errors";

type EditorState = {
  /** Content of the active note as the editor sees it. */
  noteContent: string;
  /** Scratch content typed while no note is active (drafts become notes). */
  draftNoteContent: string;
  noteDirty: boolean;
  isSaving: boolean;
  saveError: string | null;
};

export const useEditorStore = create<EditorState>(() => ({
  noteContent: "",
  draftNoteContent: "",
  noteDirty: false,
  isSaving: false,
  saveError: null,
}));

/** Editor pane DOM handle — attached by the right pane, read by focus helpers. */
export const rightPaneRef: { current: HTMLDivElement | null } = { current: null };

const SAVE_DEBOUNCE_MS = 400;

let saveTimer: number | null = null;
// Monotonic token: an in-flight note load is dropped if selection moved on.
let loadSequence = 0;

const clearSaveTimer = () => {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
};

async function saveNow(targetNote: string | null, content: string) {
  if (!targetNote) {
    return;
  }
  useEditorStore.setState({ isSaving: true, saveError: null });
  try {
    await writeNote(targetNote, content);
    if (
      useSelection.getState().activeNote === targetNote &&
      useEditorStore.getState().noteContent === content
    ) {
      useEditorStore.setState({ noteDirty: false });
    }
  } catch (error) {
    useEditorStore.setState({ saveError: getErrorMessage(error) });
    throw error;
  } finally {
    useEditorStore.setState({ isSaving: false });
  }
}

export function handleEditorChange(markdown: string) {
  const activeNote = useSelection.getState().activeNote;
  if (!activeNote) {
    if (useEditorStore.getState().draftNoteContent !== markdown) {
      useEditorStore.setState({ draftNoteContent: markdown });
    }
    return;
  }

  useEditorStore.setState((state) => ({
    noteContent: state.noteContent === markdown ? state.noteContent : markdown,
    noteDirty: true,
    saveError: null,
  }));

  clearSaveTimer();
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    const { noteContent, noteDirty } = useEditorStore.getState();
    const currentNote = useSelection.getState().activeNote;
    if (currentNote && noteDirty) {
      // Errors land in saveError; the next edit or flush retries.
      void saveNow(currentNote, noteContent).catch(() => {});
    }
  }, SAVE_DEBOUNCE_MS);
}

export const clearNote = () => {
  useEditorStore.setState({ noteContent: "", noteDirty: false });
};

export const clearDraft = () => {
  useEditorStore.setState({ draftNoteContent: "" });
};

export const primeNoteContent = (markdown: string) => {
  useEditorStore.setState({
    noteContent: markdown,
    noteDirty: false,
    saveError: null,
  });
};

export async function flushSave() {
  clearSaveTimer();
  const { noteDirty, noteContent } = useEditorStore.getState();
  const activeNote = useSelection.getState().activeNote;
  if (!activeNote || !noteDirty) {
    return;
  }
  await saveNow(activeNote, noteContent);
}

// Leaving a note flushes it: dirty-and-emptied notes are deleted, dirty ones
// saved, and slug-capable filename modes get their content-derived rename.
// Then the newly active note (if any) is read in.
async function handleActiveNoteChange(
  previousNote: string | null,
  activeNote: string | null
) {
  clearSaveTimer();
  const { noteContent: previousContent, noteDirty: previousDirty } =
    useEditorStore.getState();
  loadSequence += 1;
  const sequence = loadSequence;

  if (previousNote && previousNote !== activeNote) {
    try {
      const trimmed = previousContent.trim();
      if (previousDirty && !trimmed) {
        await deleteItems([previousNote]);
        void refreshTree();
      } else {
        if (previousDirty) {
          await saveNow(previousNote, previousContent);
        }
        if (trimmed) {
          // The editor owns the timing of the flush; the notes domain owns
          // the filename policy.
          const { noteFileNameFormat } = selectSyncSettings(
            useProfilesStore.getState()
          );
          const renameTarget = getAutoRenameTarget(
            previousNote,
            previousContent,
            noteFileNameFormat
          );
          if (renameTarget) {
            await renameItem(previousNote, renameTarget);
            void refreshTree();
          }
        }
      }
    } catch (error) {
      console.error("[notes] failed to flush previous note", error);
    }
  }

  if (!activeNote) {
    if (sequence === loadSequence) {
      useEditorStore.setState({ noteDirty: false });
    }
    return;
  }

  const content = await readNote(activeNote);
  if (sequence === loadSequence) {
    useEditorStore.setState({
      noteContent: content,
      noteDirty: false,
      saveError: null,
    });
  }
}

/** Wire editor lifecycle to selection/profile changes. Call once at boot. */
export function initEditor() {
  useSelection.subscribe((state, previous) => {
    if (state.activeNote !== previous.activeNote) {
      void handleActiveNoteChange(previous.activeNote, state.activeNote);
    }
  });

  // Editor state belongs to a profile root and must not survive a switch.
  // (Registered before bootstrap's selection reset, so the flush triggered by
  // that reset sees an already-cleared editor and cannot write stale content
  // into the new root.)
  useProfilesStore.subscribe((state, previous) => {
    const activeProfileId = selectActiveProfileId(state);
    if (!activeProfileId) {
      return;
    }
    if (
      activeProfileId !== selectActiveProfileId(previous) ||
      selectActiveProfileNotesRoot(state) !==
        selectActiveProfileNotesRoot(previous)
    ) {
      clearNote();
      clearDraft();
    }
  });

  // Pending saves must hit disk before a profile mutation swaps the root.
  registerProfileMutationFlush(flushSave);

  // Background flushes: app hidden or quitting.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void flushSave();
    }
  });
  window.addEventListener("beforeunload", () => {
    void flushSave();
  });
}
