import { useEffect, useMemo, useState } from "react";
import { useSelection } from "../contexts/SelectionContext";
import { useEditor } from "../contexts/EditorContext";
import { useNotesTree } from "../contexts/NotesTreeContext";

import { NoteEditor } from "../components/NoteEditor";
import { MultiNoteLens } from "../components/MultiNoteLens";
import { RecordingNoteHeader } from "../components/RecordingNoteHeader";
import {
  SettingsDetailPane,
  type SettingsSectionId,
} from "../components/SettingsPanel";
import { sanitizeRecordingEditorContent } from "../utils/format";

import { focusNoScroll } from "../utils/dom";
import type { AppMode } from "../types";

type DesktopRightPaneProps = {
  appMode: AppMode;
  activeSettingsSection: SettingsSectionId;
};

export function DesktopRightPane({
  appMode,
  activeSettingsSection,
}: DesktopRightPaneProps) {
  const { activeNote, selectedNotes } = useSelection();
  const [isLensPinned, setIsLensPinned] = useState(false);
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
    if (selectedNotes.size > 1) {
      setIsLensPinned(true);
    }
  }, [selectedNotes]);

  const shouldShowLens = selectedNotePaths.length > 1 || isLensPinned;

  const lensNotes = useMemo(
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

  if (appMode === "notes") {
    return (
      <div className="pane editor-pane min-w-0">
        <div
          className="pane-body editor-body"
          ref={rightPaneRef}
          tabIndex={0}
          onClick={() => {
            if (shouldShowLens) {
              return;
            }
            const editorElement =
              rightPaneRef.current?.querySelector<HTMLElement>(
                ".tiptap-content[contenteditable='true']"
              ) || rightPaneRef.current;
            focusNoScroll(editorElement);
          }}
        >
          {shouldShowLens ? (
            <MultiNoteLens
              notes={lensNotes}
              activeNote={activeNote}
              onBeforePersist={flushSave}
              onActiveNoteContentSync={(nextMarkdown) => {
                if (activeNote) {
                  handleEditorChange(nextMarkdown);
                }
              }}
              onExitLens={selectedNotePaths.length > 1 ? undefined : () => setIsLensPinned(false)}
            />
          ) : (
            <div className="editor-single">
              <div className="editor-top-row">
                {selectedNotePaths.length > 0 ? (
                  <button
                    type="button"
                    className="editor-lens-toggle"
                    onClick={() => setIsLensPinned(true)}
                  >
                    Open Lens
                  </button>
                ) : null}
              </div>
              <RecordingNoteHeader notePath={activeNote} preview={activeNotePreview} />
              <NoteEditor
                markdown={editorMarkdown}
                onChange={handleEditorChange}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <SettingsDetailPane
      activeSection={activeSettingsSection}
      onPaneClick={() => focusNoScroll(rightPaneRef.current)}
    />
  );
}
