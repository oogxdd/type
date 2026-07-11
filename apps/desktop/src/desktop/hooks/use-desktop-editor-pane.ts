import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useSelection } from "@/app/state/selection-store";
import { APP_EXTENSIONS } from "@/features/extensions/registry";
import { writeNote } from "@/features/notes/api/notes-api";
import {
  flushSave,
  handleEditorChange as updateEditorContent,
  primeNoteContent,
  rightPaneRef,
  useEditorStore,
} from "@/features/notes/editor/state/editor-store";
import type { LensNote } from "@/features/lens/hooks/use-lens-annotations";
import { getLatestFeedTargetTimestamp } from "@/features/notes/navigation/model/feed-tree-model";
import { useNotesTree } from "@/features/notes/navigation/state/notes-tree-context";
import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";
import { sanitizeRecordingEditorContent } from "@typenotes/shared/format";

export function useDesktopEditorPane() {
  const { activeFolder, activeNote, selectedNotes } = useSelection(
    useShallow((state) => ({
      activeFolder: state.activeFolder,
      activeNote: state.activeNote,
      selectedNotes: state.selectedNotes,
    }))
  );
  const [isLensPinned, setIsLensPinned] = useState(false);
  const [isLensMenuOpen, setIsLensMenuOpen] = useState(false);
  const noteContent = useEditorStore((state) => state.noteContent);
  const draftNoteContent = useEditorStore((state) => state.draftNoteContent);
  const {
    notes,
    notePreviews,
    allNotePreviews,
    activeFeedNode,
    createNewNote,
  } = useNotesTree();
  const draftCreationRef = useRef<Promise<string | null> | null>(null);
  const pendingDraftRef = useRef("");

  const handleEditorChange = useCallback(
    (nextMarkdown: string) => {
      updateEditorContent(nextMarkdown);
      if (activeNote) {
        return;
      }

      pendingDraftRef.current = nextMarkdown;
      if (!nextMarkdown.trim() || draftCreationRef.current) {
        return;
      }

      const folderPath = activeFolder || FEED_FOLDER_PATH;
      const targetTimestampMs =
        folderPath === FEED_FOLDER_PATH
          ? getLatestFeedTargetTimestamp(activeFeedNode) ?? undefined
          : undefined;
      const initialContent = nextMarkdown;
      const creation = createNewNote(
        folderPath,
        initialContent,
        targetTimestampMs
      )
        .then(async (path) => {
          if (!path) {
            return null;
          }
          const latestContent = pendingDraftRef.current;
          if (latestContent !== initialContent) {
            await writeNote(path, latestContent);
            primeNoteContent(latestContent);
            window.dispatchEvent(new CustomEvent("note-previews-invalidated"));
          }
          return path;
        })
        .catch((error) => {
          console.error("[notes] failed to create note from editor draft", error);
          return null;
        })
        .finally(() => {
          draftCreationRef.current = null;
        });
      draftCreationRef.current = creation;
    },
    [activeFeedNode, activeFolder, activeNote, createNewNote]
  );

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
