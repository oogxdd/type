import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useSelection } from "@/app/state/selection-store";
import { APP_EXTENSIONS } from "@/features/extensions/registry";
import { useEditor } from "@/features/notes/editor/hooks/editor-context";
import type { LensNote } from "@/features/lens/hooks/use-lens-annotations";
import { useNotesTree } from "@/features/notes/navigation/state/notes-tree-context";
import { sanitizeRecordingEditorContent } from "@/shared/lib/format";

export function useDesktopEditorPane() {
  const { activeNote, selectedNotes } = useSelection(
    useShallow((state) => ({
      activeNote: state.activeNote,
      selectedNotes: state.selectedNotes,
    }))
  );
  const [isLensPinned, setIsLensPinned] = useState(false);
  const [isLensMenuOpen, setIsLensMenuOpen] = useState(false);
  const {
    noteContent,
    draftNoteContent,
    handleEditorChange,
    flushSave,
    rightPaneRef,
  } = useEditor();
  const { notes, notePreviews, allNotePreviews } = useNotesTree();

  const selectedNotePaths = useMemo(() => {
    const orderedByMiddleList = notes
      .map((note) => note.path)
      .filter((path) => selectedNotes.has(path));
    const remainingSelected = Array.from(selectedNotes).filter(
      (path) => !orderedByMiddleList.includes(path)
    );
    const mergedSelection = [...orderedByMiddleList, ...remainingSelected];
    if (mergedSelection.length > 0) {
      return mergedSelection;
    }
    return activeNote ? [activeNote] : [];
  }, [activeNote, notes, selectedNotes]);

  useEffect(() => {
    if (APP_EXTENSIONS.multiLens && selectedNotes.size > 1) {
      setIsLensPinned(true);
    }
  }, [selectedNotes]);

  const canOpenLens = APP_EXTENSIONS.multiLens && selectedNotePaths.length > 0;
  const shouldShowLens =
    APP_EXTENSIONS.multiLens && (selectedNotePaths.length > 1 || isLensPinned);

  // Only the lazy lens component needs this shape; keeping the derivation here
  // prevents the right pane from knowing about preview fallback details.
  const lensNotes = useMemo<LensNote[]>(
    () =>
      selectedNotePaths.map((path) => {
        const preview = notePreviews[path] || allNotePreviews[path];
        return {
          path,
          title: preview?.title || path.split("/").pop()?.replace(/\.md$/i, "") || path,
          dateLabel: preview?.dateLabel || "",
          isRecording: Boolean(preview?.isRecording),
          transcriptionStatus: preview?.transcriptionStatus || null,
        };
      }),
    [allNotePreviews, notePreviews, selectedNotePaths]
  );

  const activeNotePreview = activeNote
    ? notePreviews[activeNote] || allNotePreviews[activeNote]
    : undefined;
  const editorMarkdown =
    activeNote && activeNotePreview?.isRecording
      ? sanitizeRecordingEditorContent(noteContent, activeNotePreview.transcriptionStatus)
      : activeNote
        ? noteContent
        : draftNoteContent;

  const openLens = useCallback(() => {
    if (!APP_EXTENSIONS.multiLens) {
      return;
    }
    setIsLensPinned(true);
    setIsLensMenuOpen(false);
  }, []);

  const closeLens = useCallback(() => {
    setIsLensPinned(false);
  }, []);

  const syncActiveNoteContent = useCallback(
    (nextMarkdown: string) => {
      if (activeNote) {
        handleEditorChange(nextMarkdown);
      }
    },
    [activeNote, handleEditorChange]
  );

  return {
    activeNote,
    selectedNotePaths,
    activeNotePreview,
    editorMarkdown,
    handleEditorChange,
    flushSave,
    rightPaneRef,
    canOpenLens,
    shouldShowLens,
    lensNotes,
    isLensMenuOpen,
    setIsLensMenuOpen,
    openLens,
    closeLens,
    syncActiveNoteContent,
  };
}
